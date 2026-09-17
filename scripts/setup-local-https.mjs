import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(
  new URL("../work.local/https/", import.meta.url),
);
const caKeyPath = join(outputDirectory, "headless-paint-local-ca-key.pem");
const caCertPath = join(outputDirectory, "headless-paint-local-ca.crt");
const serverKeyPath = join(outputDirectory, "server-key.pem");
const serverCsrPath = join(outputDirectory, "server.csr");
const serverCertPath = join(outputDirectory, "server-cert.pem");
const serverExtensionsPath = join(outputDirectory, "server-extensions.cnf");
const caSerialPath = join(outputDirectory, "headless-paint-local-ca.srl");

function runOpenSsl(args) {
  execFileSync("openssl", args, { stdio: "inherit" });
}

function localIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return [...new Set(addresses)].sort();
}

mkdirSync(outputDirectory, { recursive: true });

if (!existsSync(caKeyPath) || !existsSync(caCertPath)) {
  runOpenSsl(["genrsa", "-out", caKeyPath, "3072"]);
  runOpenSsl([
    "req",
    "-x509",
    "-new",
    "-sha256",
    "-key",
    caKeyPath,
    "-days",
    "3650",
    "-out",
    caCertPath,
    "-subj",
    "/CN=Headless Paint Local Development CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
    "-addext",
    "keyUsage=critical,keyCertSign,cRLSign",
  ]);
}

const ipv4Addresses = localIpv4Addresses();
const ipEntries = ["127.0.0.1", ...ipv4Addresses]
  .map((address, index) => `IP.${index + 1} = ${address}`)
  .join("\n");
writeFileSync(
  serverExtensionsPath,
  [
    "authorityKeyIdentifier=keyid,issuer",
    "basicConstraints=critical,CA:FALSE",
    "keyUsage=critical,digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    "subjectAltName=@alt_names",
    "",
    "[alt_names]",
    "DNS.1 = localhost",
    ipEntries,
    "",
  ].join("\n"),
);

runOpenSsl([
  "req",
  "-new",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-keyout",
  serverKeyPath,
  "-out",
  serverCsrPath,
  "-subj",
  "/CN=headless-paint.local",
]);
runOpenSsl([
  "x509",
  "-req",
  "-sha256",
  "-in",
  serverCsrPath,
  "-CA",
  caCertPath,
  "-CAkey",
  caKeyPath,
  "-CAserial",
  caSerialPath,
  "-CAcreateserial",
  "-days",
  "397",
  "-extfile",
  serverExtensionsPath,
  "-out",
  serverCertPath,
]);
chmodSync(caKeyPath, 0o600);
chmodSync(serverKeyPath, 0o600);

console.log(`\nGenerated local HTTPS files in ${outputDirectory}`);
console.log(`Install and trust this CA certificate on iPad: ${caCertPath}`);
for (const address of ipv4Addresses) {
  console.log(`HTTPS host: https://${address}:<port printed by Vite>/`);
}
