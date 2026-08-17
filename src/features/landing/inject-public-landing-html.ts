import { FREE_LP_H1 } from "./free-landing-copy";
import {
  PUBLIC_LANDING_ASSET_PATHS,
  buildPublicLandingHeadHtml,
  buildPublicLandingHtml,
} from "./build-public-landing-html";

export const PUBLIC_LANDING_HEAD_MARK = "<!-- kondate-public-lp-head -->";
export const PUBLIC_LANDING_MOUNT = '<div id="kondate-public-lp"></div>';

// Vite は絶対パスでも相対パスでも渡すことがある。区切りは / に正規化する。
export function isPublicLandingIndexFilename(filename: string): boolean {
  return filename.replaceAll("\\", "/").endsWith("/index.html") || filename === "index.html";
}

export function injectPublicLandingHtml(html: string): string {
  // transformIndexHtml が二重に呼ばれても本文を重ねない。
  if (html.includes('id="kondate-public-lp"') && html.includes(FREE_LP_H1)) {
    return html;
  }
  if (!html.includes('id="kondate-public-lp"')) {
    throw new Error("public_lp_mount_missing");
  }
  // 中身付きマウントは置換対象外。誤って上書きしない。
  if (!html.includes(PUBLIC_LANDING_MOUNT)) {
    throw new Error("public_lp_mount_not_empty");
  }
  if (!html.includes(PUBLIC_LANDING_HEAD_MARK)) {
    throw new Error("public_lp_head_mark_missing");
  }
  const filled = html
    .replace(PUBLIC_LANDING_HEAD_MARK, buildPublicLandingHeadHtml())
    .replace(
      PUBLIC_LANDING_MOUNT,
      `<div id="kondate-public-lp">${buildPublicLandingHtml(PUBLIC_LANDING_ASSET_PATHS)}</div>`,
    );
  if (!filled.includes(FREE_LP_H1)) {
    throw new Error("public_lp_insert_failed");
  }
  if (!filled.includes('name="description"')) {
    throw new Error("public_lp_meta_missing");
  }
  return filled;
}
