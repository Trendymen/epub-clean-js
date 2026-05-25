// src/core/constants.js
export const OPF_NS = "http://www.idpf.org/2007/opf";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const EPUB_NS = "http://www.idpf.org/2007/ops";
export const CONTAINER_NS = "urn:oasis:names:tc:opendocument:xmlns:container";

export const MIME2EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
  "application/font-sfnt": ".ttf",
  "application/vnd.ms-opentype": ".otf",
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "application/xhtml+xml": ".xhtml",
  "application/x-dtbncx+xml": ".ncx",
};

export const SKIP_NAMES = new Set([
  "META-INF/encryption.xml",
  "META-INF/zhangyue-expansion.xml",
]);

export const TEXT_EXTS = new Set([".xhtml", ".html", ".ncx", ".css", ".opf"]);
