#!/usr/bin/env node
/*
 * MeshDrop relay — device-to-device file sharing across the bonded mesh.
 *
 * Zero dependencies (Node core only). Every device on the bond can reach this
 * relay, so any phone/tablet sends & receives files by browser — no per-device
 * app install. The MeshLink app's MeshDrop tab talks to these endpoints.
 *
 *   POST /upload?to=<peer|all>&from=<name>&name=<file>&mime=<type>
 *        body = raw file bytes                       -> { id }
 *   GET  /peers?self=<name>    (also a heartbeat)    -> { peers: [...] }
 *   GET  /inbox?self=<name>                          -> { files: [...] }
 *   GET  /download/<id>                              -> file stream
 *   GET  /health                                     -> { ok: true }
 *
 * Run:  PORT=8088 node meshdrop-relay.js
 * (install-meshdrop-relay.sh sets it up as a systemd service on boot.)
 */
'use strict'

const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { URL } = require('url')

const PORT = parseInt(process.env.PORT || '8088', 10)
const DATA_DIR = process.env.MESHDROP_DIR || '/var/lib/meshdrop'
const FILES_DIR = path.join(DATA_DIR, 'files')
const MAX_BYTES = parseInt(process.env.MESHDROP_MAX_BYTES || String(2 * 1024 * 1024 * 1024), 10) // 2 GB
const PEER_TTL_MS = 45_000 // a device is "online" if seen within this window
const FILE_TTL_MS = 24 * 60 * 60 * 1000 // prune files older than 24h

fs.mkdirSync(FILES_DIR, { recursive: true })

// In-memory indexes. Files live on disk; metadata + presence in memory.
/** @type {Map<string, {id,name,size,mime,from,to,createdAt,path}>} */
const files = new Map()
/** @type {Map<string, number>} name -> lastSeen ms */
const peers = new Map()

function id() {
  return crypto.randomBytes(9).toString('hex')
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function json(res, code, obj) {
  cors(res)
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function touchPeer(name) {
  if (name) peers.set(name, Date.now())
}

function onlinePeers() {
  const now = Date.now()
  const out = []
  for (const [name, seen] of peers) {
    if (now - seen <= PEER_TTL_MS) out.push({ id: name, name, online: true })
    else peers.delete(name)
  }
  return out
}

function pruneFiles() {
  const now = Date.now()
  for (const [fid, meta] of files) {
    if (now - meta.createdAt > FILE_TTL_MS) {
      fs.unlink(meta.path, () => {})
      files.delete(fid)
    }
  }
}
setInterval(pruneFiles, 60_000).unref()

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const p = url.pathname

  if (req.method === 'OPTIONS') {
    cors(res)
    res.writeHead(204)
    return res.end()
  }

  // --- upload ---
  if (req.method === 'POST' && p === '/upload') {
    const q = url.searchParams
    const meta = {
      id: id(),
      name: q.get('name') || 'file',
      mime: q.get('mime') || 'application/octet-stream',
      from: q.get('from') || 'unknown',
      to: q.get('to') || 'all',
      createdAt: Date.now(),
      size: 0,
    }
    touchPeer(meta.from)
    const dest = path.join(FILES_DIR, meta.id)
    const out = fs.createWriteStream(dest)
    let bytes = 0
    let aborted = false

    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BYTES && !aborted) {
        aborted = true
        out.destroy()
        fs.unlink(dest, () => {})
        json(res, 413, { error: 'file too large' })
        req.destroy()
      }
    })
    req.pipe(out)
    out.on('finish', () => {
      if (aborted) return
      meta.size = bytes
      meta.path = dest
      files.set(meta.id, meta)
      json(res, 200, { id: meta.id })
    })
    out.on('error', () => {
      if (!aborted) json(res, 500, { error: 'write failed' })
    })
    return
  }

  // --- peers (heartbeat) ---
  if (req.method === 'GET' && p === '/peers') {
    touchPeer(url.searchParams.get('self'))
    return json(res, 200, { peers: onlinePeers() })
  }

  // --- inbox ---
  if (req.method === 'GET' && p === '/inbox') {
    const self = url.searchParams.get('self') || ''
    touchPeer(self)
    const inbox = []
    for (const meta of files.values()) {
      const forMe = meta.to === self || meta.to === 'all'
      if (forMe && meta.from !== self) {
        inbox.push({
          id: meta.id,
          name: meta.name,
          size: meta.size,
          mime: meta.mime,
          from: meta.from,
          createdAt: meta.createdAt,
        })
      }
    }
    inbox.sort((a, b) => b.createdAt - a.createdAt)
    return json(res, 200, { files: inbox })
  }

  // --- download ---
  if (req.method === 'GET' && p.startsWith('/download/')) {
    const fid = p.slice('/download/'.length)
    const meta = files.get(fid)
    if (!meta || !fs.existsSync(meta.path)) {
      return json(res, 404, { error: 'not found' })
    }
    cors(res)
    res.writeHead(200, {
      'Content-Type': meta.mime,
      'Content-Length': meta.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(meta.name)}"`,
    })
    return fs.createReadStream(meta.path).pipe(res)
  }

  // --- health ---
  if (req.method === 'GET' && (p === '/health' || p === '/')) {
    return json(res, 200, { ok: true, service: 'meshdrop-relay', peers: onlinePeers().length, files: files.size })
  }

  json(res, 404, { error: 'not found' })
})

server.listen(PORT, () => {
  console.log(`[meshdrop] relay listening on :${PORT}  data=${DATA_DIR}  max=${MAX_BYTES}B`)
})
