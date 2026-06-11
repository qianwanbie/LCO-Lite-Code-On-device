const http = require("http");
const data = JSON.stringify({jsonrpc:"2.0",id:1,method:"claudeChat",params:{message:"hi"}});
const req = http.request({hostname:"127.0.0.1",port:9876,path:"/api/rpc",method:"POST",headers:{"Content-Type":"application/json","Content-Length":data.length}}, res => {
  let body = "";
  res.on("data", c => body += c);
  res.on("end", () => console.log("RESPONSE:", body));
});
req.on("error", e => console.log("ERROR:", e.message));
req.write(data);
req.end();
