import path from "node:path/posix";

export function unquoteRecursive(s) {
  let prev = null;
  let cur = s;
  while (prev !== cur) {
    prev = cur;
    try {
      cur = decodeURIComponent(cur);
    } catch {
      return cur;
    }
  }
  return cur;
}

const SKIP_PREFIXES = ["data:", "http://", "https://", "mailto:", "tel:", "#"];

export function remapPath(href, mapping, base = "") {
  if (SKIP_PREFIXES.some((p) => href.startsWith(p))) return href;

  let pathPart;
  let frag = "";
  const hashIdx = href.indexOf("#");
  if (hashIdx >= 0) {
    pathPart = href.slice(0, hashIdx);
    frag = href.slice(hashIdx);
  } else {
    pathPart = href;
  }
  if (!pathPart) return href;

  pathPart = unquoteRecursive(pathPart);
  const absInOpf = path.normalize(path.join(base, pathPart));
  const newAbs = mapping[absInOpf] ?? absInOpf;
  let rel = path.relative(base || ".", newAbs);
  if (!rel) rel = ".";
  return rel + frag;
}
