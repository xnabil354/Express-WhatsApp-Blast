const phoneNumberFormatter = function (number) {
  let formatted = number.replace(/\D/g, "");

  if (formatted.startsWith("0"))
    return (formatted = "62" + formatted.substr(1));

  if (!formatted.endsWith("@c.us")) return (formatted += "@c.us");

  return formatted;
};

module.exports = {
  phoneNumberFormatter,
};
