const http = require('http');

setInterval(() => {
  const options = {
    hostname: 'localhost',
    port: 9090,
    path: "/login?username=admin' OR 1=1",
    method: 'GET'
  };

  const req = http.request(options);
  req.end();
}, 200);