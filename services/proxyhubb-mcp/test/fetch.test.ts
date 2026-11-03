import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import {
  checkTarget,
  decodeBody,
  decodeEntities,
  htmlToText,
  parseHttpResponseBytes,
  readPage,
  ResponseTracker,
} from "../src/fetch.ts";

describe("checkTarget", () => {
  it("accepts public https pages on 443 and 8443", () => {
    for (const u of ["https://example.com/", "https://shop.example.com:8443/a?b=1", "https://93.184.216.34/"]) {
      assert.equal(checkTarget(u).ok, true, u);
    }
  });

  it("refuses other schemes, credentials, ports and internal addresses", () => {
    for (const u of [
      "http://example.com/",
      "ftp://example.com/",
      "https://user:pw@example.com/",
      "https://example.com:22/",
      "https://127.0.0.1/",
      "https://0x7f.1/",
      "https://10.1.2.3/",
      "https://172.20.0.1/",
      "https://192.168.1.1/",
      "https://100.64.0.1/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
      "https://localhost/",
      "https://printer.local/",
      "https://router/",
      "not a url",
    ]) {
      assert.equal(checkTarget(u).ok, false, u);
    }
  });
});

describe("HTTP responses on bytes", () => {
  it("decodes chunked bodies with a multi-byte character split across chunks", () => {
    const text = Buffer.from("Accra ₵ café", "utf8");
    const a = text.subarray(0, 7); // ends inside the 3-byte "₵"
    const b = text.subarray(7);
    const raw = Buffer.concat([
      Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n"),
      Buffer.from(`${a.length.toString(16)}\r\n`),
      a,
      Buffer.from(`\r\n${b.length.toString(16)}\r\n`),
      b,
      Buffer.from("\r\n0\r\n\r\n"),
    ]);
    const parsed = parseHttpResponseBytes(raw);
    assert.equal(parsed.status, 200);
    assert.equal(parsed.headers["content-type"], "text/plain");
    assert.equal(parsed.body.toString("utf8"), "Accra ₵ café");
  });

  it("decodes gzip, keeps what arrived of a truncated stream, and rejects unknown encodings", () => {
    const original = `${"x".repeat(5000)}END`;
    const gz = gzipSync(Buffer.from(original));
    assert.equal(decodeBody(gz, "gzip")?.toString(), original);
    const partial = decodeBody(gz.subarray(0, gz.length - 10), "gzip");
    assert.ok(partial && partial.length > 0 && partial.toString().startsWith("xxxx"));
    assert.equal(decodeBody(Buffer.from("abc"), "compress"), null);
  });

  it("knows when a response is complete", () => {
    const byLength = new ResponseTracker();
    assert.equal(byLength.push(Buffer.from("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nab")), false);
    assert.equal(byLength.push(Buffer.from("cde")), true);

    const chunked = new ResponseTracker();
    assert.equal(chunked.push(Buffer.from("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r")), false);
    assert.equal(chunked.push(Buffer.from("\n\r\n")), true);

    const closeDelimited = new ResponseTracker();
    assert.equal(closeDelimited.push(Buffer.from("HTTP/1.1 200 OK\r\n\r\nstreaming")), false);

    assert.equal(new ResponseTracker().push(Buffer.from("HTTP/1.1 304 Not Modified\r\n\r\n")), true);
  });
});

describe("page text", () => {
  it("decodes entities", () => {
    assert.equal(decodeEntities("&amp;&lt;&#8373;&#x20B5;&bogus;"), "&<₵₵&bogus;");
  });

  it("drops scripts and styles, keeps readable text and the title", () => {
    const { title, text } = htmlToText(
      "<html><head><title> Shop &amp; Co </title><style>p{}</style></head><body><script>alert(1)</script><h1>Sign up</h1><p>Price:<br>GH&#8373; 120</p><!-- hidden --></body></html>",
    );
    assert.equal(title, "Shop & Co");
    assert.equal(text, "Sign up\nPrice:\nGH₵ 120");
  });

  it("honours the charset, decompresses HTML and refuses binary bodies as text", () => {
    const latin1 = readPage({ "content-type": "text/plain; charset=iso-8859-1" }, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    assert.equal(latin1.text, "café");

    const html = readPage(
      { "content-type": "text/html", "content-encoding": "gzip" },
      gzipSync(Buffer.from("<title>Hi</title><p>Hello</p>")),
    );
    assert.equal(html.title, "Hi");
    assert.equal(html.text, "Hello");

    const image = readPage({ "content-type": "image/png" }, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    assert.equal(image.text, null);
    assert.match(String(image.note), /Binary content/);
  });
});
