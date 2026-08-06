const requestHandler = require('../server.js');

module.exports = async (req, res) => {
  return await requestHandler(req, res);
};
