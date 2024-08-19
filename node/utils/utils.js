const crypto = require('crypto');

function getDictValueOrNone(dictionary, key) {
  if (dictionary === null || !dictionary.hasOwnProperty(key)) {
    return null;
  }
  return dictionary[key];
}

function getDictValueOrDefault(dictionary, key, defaultValue) {
  if (dictionary === null || !dictionary.hasOwnProperty(key)) {
    return defaultValue;
  }
  return dictionary[key];
}

function prettyPrint(jsonObject) {
  console.log(JSON.stringify(jsonObject, null, 4));
  console.log("\n");
}

function prettyPrintExcept(jsonObject, exceptKeys = []) {
  if (jsonObject === null) {
    return;
  }

  const jsonObjectCopy = { ...jsonObject };
  exceptKeys.forEach(key => {
    delete jsonObjectCopy[key];
  });

  prettyPrint(jsonObjectCopy);
}

function base64UrlEncode(data) {
  return Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function generateChallenge(length) {
  const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let challenge = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(0, characters.length);
    challenge += characters[randomIndex];
  }
  return challenge;
}
// Exporting all functions
module.exports = {
    getDictValueOrNone,
    getDictValueOrDefault,
    prettyPrint,
    prettyPrintExcept,
    base64UrlEncode,
    generateChallenge
  };
