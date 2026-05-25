// src/core/stages/align.js
import { Buffer } from "node:buffer";
import {
  serializeOpf,
  findFirst,
  childrenOf,
  getAttr,
  setText,
  makeNode,
} from "../opf.js";

function tagName(node) {
  for (const k of Object.keys(node)) if (k !== ":@") return k;
  return null;
}

function hasChild(kids, tag) {
  return kids.some((n) => tagName(n) === tag);
}

function applyMetadataDefaults(pkg, profile) {
  if (!profile || !profile.metadataDefaults) return;
  const md = profile.metadataDefaults;
  const metadata = findFirst(childrenOf(pkg), "metadata");
  if (!metadata) return;
  const kids = childrenOf(metadata);

  // dc:rights：缺则补，已有则保留
  if (md.rights && !hasChild(kids, "dc:rights")) {
    kids.push(makeNode("dc:rights", {}, md.rights));
  }
  // dc:publisher
  if (md.publisher && !hasChild(kids, "dc:publisher")) {
    kids.push(makeNode("dc:publisher", {}, md.publisher));
  }
  // dc:language
  if (md.language && !hasChild(kids, "dc:language")) {
    kids.push(makeNode("dc:language", {}, md.language));
  }
  // dc:contributor + file-as refines
  if (Array.isArray(md.contributors)) {
    for (const c of md.contributors) {
      const id = `contributor-${c.name}`.replace(/\s+/g, "-");
      kids.push(makeNode("dc:contributor", { id }, c.name));
      if (c.fileAs) {
        kids.push(makeNode("meta", { refines: "#" + id, property: "file-as" }, c.fileAs));
      }
      if (c.role) {
        kids.push(makeNode("meta", { refines: "#" + id, property: "role", scheme: "marc:relators" }, c.role));
      }
    }
  }
  // dcterms:modified 覆盖（heal 已写入今日 ISO，profile 可覆盖）
  if (md.modified && md.modified !== "auto") {
    const found = kids.find(
      (n) => tagName(n) === "meta" && getAttr(n, "property") === "dcterms:modified",
    );
    if (found) setText(found, md.modified);
  }
}

export function align(buf, ctx) {
  const { opfPath, opfTree } = buf.meta;
  const pkg = findFirst(opfTree, "package");

  applyMetadataDefaults(pkg, ctx.profile);

  const newEntries = { ...buf.entries };
  newEntries[opfPath] = Buffer.from(serializeOpf(opfTree), "utf-8");
  return { ...buf, entries: newEntries };
}
