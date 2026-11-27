import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

function rejectNetwork() {
  throw new Error("Network access is forbidden in the recovery tests.");
}

globalThis.fetch = rejectNetwork;
http.request = rejectNetwork;
http.get = rejectNetwork;
https.request = rejectNetwork;
https.get = rejectNetwork;
net.connect = rejectNetwork;
net.createConnection = rejectNetwork;
tls.connect = rejectNetwork;
