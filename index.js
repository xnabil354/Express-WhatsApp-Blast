const path = require("path");
const { Client, MessageMedia, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const { body, validationResult } = require("express-validator");
const socketIO = require("socket.io");
const bcrypt = require("bcrypt");
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

const { phoneNumberFormatter } = require("./helpers/formatter");

const port = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(useragent.express());
app.use(express.static("public"));
app.set("trust proxy", true);
app.set("json spaces", 2);
app.use(logger("dev"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.set("view engine", "ejs");
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
  res.render("login");
});

app.post("/whatsapp-blast", async (req, res) => {
  const defaultUsername = "admin@bintek.com";
  const defaultPassword = "P@ssw0rd123";

  // Manually check for default credentials
  if (req.body.username === defaultUsername || req.body.password === defaultPassword
  ) {
    res.render("app");
  } else {
    return res.status(422).json({
      status: false,
      message: "Invalid Username or Password",
    }); // Send a generic error message for invalid credentials
  }
});

const client = new Client({
  authStrategy: new LocalAuth(),
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

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms * 1000));
};

// Socket IO
io.on("connection", function (socket) {
  socket.emit("message", "Connecting...");

  client.on("qr", (qr) => {
    console.log("QR RECEIVED");
    qrcode.toDataURL(qr, (err, url) => {
      socket.emit("qr", url);
      socket.emit("message", "QR Code received, scan please!");
    });
  });

  client.on("ready", () => {
    socket.emit("ready", "Whatsapp is ready!");
    socket.emit("message", "Whatsapp is ready!");
  });

  client.on("ready", () => {
    socket.emit("ready", "Getting group member number!");
    socket.emit("message", "Getting group member number!");
    client.getChats().then((chats) => {
      const groups = chats.filter((chat) => chat.isGroup);

      if (groups.length == 0) {
        console.log("You have no group yet.");
      } else {
        groups.forEach((group, i) => {
          const memberGrup = group.participants;
          memberGrup.forEach((member, j) => {
            fs.appendFileSync(
              "./contactlist/kontak.txt",
              member.id.user + "\r\n"
            );
          });
        });
      }
    });
    const contactGroup = fs.readFileSync("./contactlist/kontak.txt", "utf8");
    socket.emit("dump", contactGroup);
    socket.emit("message", "Gotcha!");
  });

  client.on("authenticated", () => {
    socket.emit("authenticated", "Whatsapp is authenticated!");
    socket.emit("message", "Whatsapp is authenticated!");
    console.log("AUTHENTICATED");
  });

  client.on("auth_failure", function (session) {
    socket.emit("message", "Auth failure, restarting...");
  });

  client.on("disconnected", (reason) => {
    socket.emit("message", "Whatsapp is disconnected!");
    client.destroy();
    client.initialize();
  });
});

const checkRegisteredNumber = async function (number) {
  const isRegistered = await client.isRegisteredUser(number);
  return isRegistered;
};

// Send message
app.post(
  "/send-message",
  [
    body("number").notEmpty(),
    body("sleepTime").notEmpty(),
    body("message").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    const number = phoneNumberFormatter(req.body.number);
    const delayMessage = req.body.sleepTime;
    const message = req.body.message;

    const isRegisteredNumber = await checkRegisteredNumber(number);

    if (!isRegisteredNumber) {
      return res.status(422).json({
        status: false,
        message: "The number is not registered",
      });
    }

    client
      .sendMessage(number, message)
      .then(async (response) => {
        res.status(200).json({
          code: 200,
          status: true,
          response: response,
        });
        await sleep(delayMessage);
      })
      .catch((err) => {
        res.status(500).json({
          status: false,
          code: 500,
          response: err,
        });
      });
    await sleep(delayMessage);
  }
);

// Send media
app.post("/send-media", async (req, res) => {
  const number = phoneNumberFormatter(req.body.number);
  const delayTime = req.body.sleepTime;
  const caption = req.body.caption;
  const fileUrl = req.body.file;

  // const media = MessageMedia.fromFilePath('./image-example.png');
  // const file = req.files.file;
  // const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  let mimetype;
  const attachment = await axios
    .get(fileUrl, {
      responseType: "arraybuffer",
    })
    .then((response) => {
      mimetype = response.headers["content-type"];
      return response.data.toString("base64");
    });

  const media = new MessageMedia(mimetype, attachment, "Media");

  client
    .sendMessage(number, media, {
      caption: caption,
    })
    .then(async (response) => {
      res.status(200).json({
        status: true,
        response: response,
      });
      await sleep(delayTime);
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        response: err,
      });
    });
  await sleep(delayTime);
});

const findGroupByName = async function (name) {
  const group = await client.getChats().then((chats) => {
    return chats.find(
      (chat) => chat.isGroup && chat.name.toLowerCase() == name.toLowerCase()
    );
  });
  return group;
};

// Send message to group
// You can use chatID or group name!
app.post(
  "/send-group-message",
  [
    body("id").custom((value, { req }) => {
      if (!value && !req.body.name) {
        throw new Error("Invalid value, you can use `id` or `name`");
      }
      return true;
    }),
    body("message").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    }

    let chatId = req.body.id;
    const groupName = req.body.name;
    const message = req.body.message;

    // Find the group by name
    if (!chatId) {
      const group = await findGroupByName(groupName);
      if (!group) {
        return res.status(422).json({
          status: false,
          message: "No group found with name: " + groupName,
        });
      }
      chatId = group.id._serialized;
    }

    client
      .sendMessage(chatId, message)
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
  }
);

// Clearing message on spesific chat
app.post("/clear-message", [body("number").notEmpty()], async (req, res) => {
  const errors = validationResult(req).formatWith(({ msg }) => {
    return msg;
  });

  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: false,
      message: errors.mapped(),
    });
  }

  const number = phoneNumberFormatter(req.body.number);

  const isRegisteredNumber = await checkRegisteredNumber(number);

  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: false,
      code: 422,
      message: "The number is not registered",
    });
  }

  const chat = await client.getChatById(number);

  chat
    .clearMessages()
    .then((status) => {
      res.status(200).json({
        status: true,
        code: 200,
        response: status,
      });
    })
    .catch((err) => {
      res.status(500).json({
        status: false,
        code: 500,
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
