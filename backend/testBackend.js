const http = require('http');

const server = http.createServer((req, res) => {
  console.log("Backend received:", req.method, req.url);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: "Backend working ✅",
    path: req.url
  }));
});

server.listen(8080, () => {
  console.log("✅ Backend running at http://localhost:8080");
});