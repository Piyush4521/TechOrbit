const http = require('http');

const server = http.createServer((req, res) => {
  res.end("ProxyArmor Backend Running");
});

server.listen(3000, () => {
  console.log("Main server running on http://localhost:3000");
});