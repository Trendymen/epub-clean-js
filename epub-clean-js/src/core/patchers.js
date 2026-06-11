import { remapPath } from "./paths.js";

// xhtml/html 里的属性引用，限定属性前必须为空白，避免误匹配 zy-enlarge-src 等含 -src 的自定义属性
const XHTML_ATTR_RE = /(\s)((?:xlink:)?(?:href|src))="([^"]*)"/g;

// NCX <content src="..."/>
const NCX_CONTENT_SRC_RE = /(<content\s+[^>]*\bsrc=)"([^"]+)"/g;

// CSS url(...)：含 @font-face / background-image / @import url() 三种形态
const CSS_URL_RE = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/g;

// CSS @import "..."（字符串形态，无 url 包裹）
const CSS_IMPORT_STR_RE = /@import\s+(['"])([^'"]+)\1/g;

export function patchXhtml(text, mapping, base) {
  return text.replace(XHTML_ATTR_RE, (_m, ws, attr, val) => {
    return `${ws}${attr}="${remapPath(val, mapping, base)}"`;
  });
}

export function patchNcx(text, mapping, base = "") {
  return text.replace(NCX_CONTENT_SRC_RE, (_m, prefix, val) => {
    return `${prefix}"${remapPath(val, mapping, base)}"`;
  });
}

export function patchCss(text, mapping, base = "Styles") {
  let out = text.replace(CSS_URL_RE, (m, _q, url) => {
    if (url.startsWith("data:")) return m;
    return `url(${remapPath(url, mapping, base)})`;
  });
  out = out.replace(CSS_IMPORT_STR_RE, (m, q, url) => {
    if (url.startsWith("data:")) return m;
    return `@import ${q}${remapPath(url, mapping, base)}${q}`;
  });
  return out;
}

export { XHTML_ATTR_RE };
