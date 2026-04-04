const http = require('http');

const server = http.createServer((req, res) => {
  console.log("Backend hit:", req.url);

  if (req.url === '/users') {
    res.end(JSON.stringify({ users: ["Piyush", "Dev"] }));
  } else {
    res.end("OK");
  }
});

server.listen(8080, () => {
  console.log("Mock backend running on 8080");
});