const fs = require("fs");
const p = "c:/Users/user/moboko/scripts/bootstrap-web-env.mjs";
let s = fs.readFileSync(p, "utf8");
const old = `  const paths = [\r\n    join(root, ".secrets", "web.env"),\r\n    join(home, ".moboko", "web-secrets.env"),\r\n    join(home, "web-secrets.env"),\r\n    ...(extraPath ? [extraPath] : []),\r\n  ];`;
const neu = `  const paths = [\r\n    join(root, ".secrets", "web.env"),\r\n    join(home, ".moboko", "web-secrets.env"),\r\n    join(home, "web-secrets.env"),\r\n    ...(extraPath ? [extraPath] : []),  // MOBOKO_WEB_SECRETS_FILE wins last\r\n  ];`;
if (!s.includes(old)) {
  console.error("OLD BLOCK NOT FOUND");
  process.exit(1);
}
fs.writeFileSync(p, s.replace(old, neu), "utf8");
console.log("patched paths");
