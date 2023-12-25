const path = require("path");
const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const { body, validationResult } = require("express-validator");
const socketIO = require("socket.io");
const qrcode = require("qrcode");
const cors = require("cors");
const http = require("http");
const fs = require("fs");
const fileUpload = require("express-fileupload");
const axios = require("axios");
const mime = require("mime-types");
const useragent = require("express-useragent");
const { SitemapStream, streamToPromise } = require("sitemap");
const { createGzip } = require("zlib");
const cookieParser = require("cookie-parser");
const logger = require("morgan");
const bodyParser = require("body-parser");

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(useragent.express());
app.set("trust proxy", true);
app.set("json spaces", 2);
app.use(logger("dev"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({ debug: true }));
app.use(async (req, res, next) => {
  res.locals.titleweb = "WhatsApp Blast";
  res.locals.req = req;
  res.locals.ipAddr = req.headers["cf-connecting-ip"] || req.ip;
  res.locals.ua = req.useragent;
  res.locals.speeds = Date.now();
  next();
});

app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "views", "multiAccount.html");
  res.sendFile(filePath);
});

const sessions = [];
const SESSIONS_FILE = "./MultiSession/whatsapp-sessions.json";

const createSessionsFileIfNotExists = function () {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log("Sessions file created successfully.");
    } catch (err) {
      console.log("Failed to create sessions file: ", err);
    }
  }
};

createSessionsFileIfNotExists();

const setSessionsFile = function (sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function (err) {
    if (err) {
      console.log(err);
    }
  });
};

const getSessionsFile = function () {
  return JSON.parse(fs.readFileSync(SESSIONS_FILE));
};

const createSession = function (id, description) {
  console.log("Creating session: " + id);
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: id,
    }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 3000,
    bypassCSP: true,
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-web-security",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-setuid-sandbox",
        "--disable-accelerated-2d-canvas",
        "--disable-session-crashed-bubble",
        "--start-maximized",
        "--disable-features=LightMode",
        "--force-dark-mode",
      ],
      ignoreHTTPSErrors: true,
      executablePath:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    },
  });

  client.initialize();

  client.on("qr", (qr) => {
    console.log("QR RECEIVED", qr);
    qrcode.toDataURL(qr, (err, url) => {
      io.emit("qr", { id: id, src: url });
      io.emit("message", { id: id, text: "QR Code received, scan please!" });
    });
  });

  client.on("ready", () => {
    io.emit("ready", { id: id });
    io.emit("message", { id: id, text: "Whatsapp is ready!" });

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex((sess) => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on("authenticated", () => {
    io.emit("authenticated", { id: id });
    io.emit("message", { id: id, text: "Whatsapp is authenticated!" });
  });

  client.on("auth_failure", function () {
    io.emit("message", { id: id, text: "Auth failure, restarting..." });
  });

  client.on("disconnected", (reason) => {
    io.emit("message", { id: id, text: "Whatsapp is disconnected!" });
    client.destroy();
    client.initialize();

    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex((sess) => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);

    io.emit("remove-session", id);
  });

  sessions.push({
    id: id,
    description: description,
    client: client,
  });

  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex((sess) => sess.id == id);

  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
};

const init = function (socket) {
  const savedSessions = getSessionsFile();

  if (savedSessions.length > 0) {
    if (socket) {
      savedSessions.forEach((e, i, arr) => {
        arr[i].ready = false;
      });
      socket.emit("init", savedSessions);
    } else {
      savedSessions.forEach((sess) => {
        createSession(sess.id, sess.description);
      });
    }
  }
};

init();

io.on("connection", function (socket) {
  init(socket);

  socket.on("create-session", function (data) {
    console.log("Create session: " + data.id);
    createSession(data.id, data.description);
  });
});

// Send message
app.post("/send-message", async (req, res) => {
  console.log(req);

  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;

  const client = sessions.find((sess) => sess.id == sender).client;

  // Make sure the sender is exists & ready
  if (!client) {
    return res.status(422).json({
      status: false,
      code: 422,
      message: `The sender: ${sender} is not found!`,
    });
  }

  /**
   * Check if the number is already registered
   * Copied from index.js
   *
   * Please check index.js for more validations example
   * You can add the same here!
   */
  const isRegisteredNumber = await client.isRegisteredUser(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      code: 422,
      message: "The number is not registered",
    });
  }

  client
    .sendMessage(number, message)
    .then((response) => {
      res.status(200).json({
        status: true,
        response: response,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
});

app.get("/sitemap.xml", async (req, res) => {
  res.setHeader("Content-Type", "application/xml");
  res.setHeader("Content-Encoding", "gzip");
  let pathall = [];
  app._router.stack.forEach(function (r) {
    if (r.route && r.route.path) {
      if (typeof r.route.path == "object") {
        r.route.path.map((path) => {
          pathall.push(path);
        });
      } else {
        pathall.push(r.route.path);
      }
    }
  });
  const smStream = new SitemapStream({
    hostname: req.protocol + "://" + req.host,
  });
  const pipeline = smStream.pipe(createGzip());
  pathall.filter((path) => {
    if (
      path !== "/sitemap.xml" &&
      path !== "/allpathroute" &&
      path !== "/download" &&
      path !== "/robots.txt" &&
      path !== "/headers" &&
      path !== "/ua" &&
      path !== "/index.html"
    ) {
      smStream.write({ url: path, changefreq: "daily", priority: 0.9 });
    }
  });
  smStream.end();
  streamToPromise(pipeline).then((sm) => res.send(sm));
});

app.get("/robots.txt", (req, res) => {
  res.type("text/plain");
  res.send(
    "User-agent: *\nAllow: /\nSitemap: " +
      req.protocol +
      "://" +
      req.host +
      "/sitemap.xml"
  );
});

server.listen(port, function () {
  console.log("WhatsApp Server Running on Port : " + port);
});
