import { useEffect, useState } from 'react';
import { getDB, type BlobRec } from './db';
import { uid } from '../lib/geo';

/**
 * Bilder og vedlegg lagres som Blob i IndexedDB (ingen base64-oppblåsing, ~33 % mindre).
 * Bilder skaleres til maks 1600 px (JPEG 0,82) + miniatyr 240 px. Originalen beholdes bare hvis den
 * allerede er liten nok. Samme fil to ganger (SHA-256 av originalen) lagres bare én gang.
 */
export const MAX_SIDE = 1600;
export const THUMB_SIDE = 240;

export interface StoredImage { blobId: string; thumbId: string; size: number; width: number; height: number; deduped: boolean }

async function sha256(data: ArrayBuffer): Promise<string> {
  if (crypto?.subtle?.digest) {
    const h = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // reserve (svært gamle nettlesere): enkel FNV-1a
  let x = 0x811c9dc5;
  const v = new Uint8Array(data);
  for (let i = 0; i < v.length; i++) x = Math.imul(x ^ v[i], 0x01000193) >>> 0;
  return `fnv${x.toString(16)}-${v.length}`;
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = () => rej(new Error('Kunne ikke lese bildet (format støttes ikke av nettleseren?)'));
      img.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function toBlob(canvas: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Kunne ikke komprimere bildet'))), 'image/jpeg', q));
}

async function scaled(img: HTMLImageElement, max: number, q: number): Promise<{ blob: Blob; w: number; h: number }> {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await toBlob(c, q);
  c.width = c.height = 0; // frigjør minne (viktig på iPad)
  return { blob, w: Math.round(img.naturalWidth * k), h: Math.round(img.naturalHeight * k) };
}

export async function putImage(file: Blob, name: string, projectId: string): Promise<StoredImage> {
  const db = await getDB();
  const hash = await sha256(await file.arrayBuffer());
  const existing = await db.getAllFromIndex('blobs', 'byHash', [projectId, hash]);
  const main = existing.find((b) => b.role === 'main');
  const thumbE = main && (await db.getAll('blobs')).find((b) => b.parentId === main.id && b.role === 'thumb');
  if (main && thumbE) return { blobId: main.id, thumbId: thumbE.id, size: main.size, width: main.width ?? 0, height: main.height ?? 0, deduped: true };
  const img = await loadImage(file);
  const small = Math.max(img.naturalWidth, img.naturalHeight) <= MAX_SIDE && /jpe?g|webp/.test(file.type) && file.size < 1.5e6;
  const m = small ? { blob: file, w: img.naturalWidth, h: img.naturalHeight } : await scaled(img, MAX_SIDE, 0.82);
  const t = await scaled(img, THUMB_SIDE, 0.7);
  const now = new Date().toISOString();
  const mainRec: BlobRec = { id: uid('img'), projectId, kind: 'bilde', role: 'main', name, mime: m.blob.type || 'image/jpeg', size: m.blob.size, hash, blob: m.blob, width: m.w, height: m.h, createdAt: now };
  const thumbRec: BlobRec = { id: uid('thm'), projectId, kind: 'bilde', role: 'thumb', parentId: mainRec.id, name: `${name} (miniatyr)`, mime: 'image/jpeg', size: t.blob.size, hash: `${hash}-thumb`, blob: t.blob, width: t.w, height: t.h, createdAt: now };
  const tx = db.transaction('blobs', 'readwrite');
  await Promise.all([tx.store.put(mainRec), tx.store.put(thumbRec), tx.done]);
  return { blobId: mainRec.id, thumbId: thumbRec.id, size: mainRec.size + thumbRec.size, width: m.w, height: m.h, deduped: false };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Sletter et bilde og miniatyren (bare når ingen referanser gjenstår – kalleren sjekker). */
export async function deleteImage(blobId: string) {
  const db = await getDB();
  const all = await db.getAll('blobs');
  const tx = db.transaction('blobs', 'readwrite');
  for (const b of all) if (b.id === blobId || b.parentId === blobId) tx.store.delete(b.id);
  await tx.done;
  urlCache.get(blobId) && URL.revokeObjectURL(urlCache.get(blobId)!);
  urlCache.delete(blobId);
}

const urlCache = new Map<string, string>();

export async function blobUrl(id: string): Promise<string | null> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const db = await getDB();
  const rec = await db.get('blobs', id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}

/** React-hook: objekt-URL for en lagret blob. */
export function useBlobUrl(id?: string): string | null {
  const [url, setUrl] = useState<string | null>(id ? urlCache.get(id) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!id) return;
    blobUrl(id).then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [id]);
  return url;
}
