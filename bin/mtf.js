#! /usr/bin/env node
const fs = require('fs')
const path = require('path')
const mkdirp = require('mkdirp')
const klawSync = require('klaw-sync');

// Simple check to see if we are running on Windows
// (yes, this actually works on 64-bit windows too)
const isWindows = () => process.platform === "win32";

// allowed subcommands
const cmds = ["create", "extract", "list"];

const cmd = process.argv[2];
const archive = process.argv[3];
const dir = process.argv[4] ? path.resolve(process.argv[4]) : "";

// Check arguments
if (cmds.indexOf(cmd) < 0 ||
  process.argv.length < (cmd === "list" ? 4 : 5)) {
  console.warn(`Usage: mtf (${cmds.join("|")}) mtf-file [path...]`)
  process.exit(1)
}

// Check if input directory exists
if (cmd == 'create') {
  // Check all passed paths and resolve them to full paths
  const dirs = process.argv.slice(4).map(dir => {
    try {
      if (!fs.statSync(dir).isDirectory()) {
        console.error(`"${dir}" is not a directory!`)
        process.exit(2);
      }
    } catch (e) {
      console.log(`${dir}: ${e.message}`);
      process.exit(2);
    }

    return path.resolve(dir);
  })

  // Pass them to create to combine them into an archive
  create(archive, dirs);
} else if (cmd == 'extract') {
  try {
    if (!fs.statSync(dir).isDirectory()) {
      console.error(`"${dir}" is not a directory!`)
      process.exit(2);
    }

    if (!fs.statSync(archive).isFile()) {
      console.error(`"${archive}" is not a file!`)
      process.exit(2);
    }
  } catch (e) { }

  // arguments are okay, lets go!
  extract(dir, archive);
} else if (cmd === "list") {
  extract(dir, archive, true /* display only */);
}

function create(archive, dirs) {
  let paths

  // Create list of info needed to build MTF
  const dirInfos = dirs.map(dir => {
    // Find all files to include in archive
    try {
      paths = klawSync(dir, { nodir: true })
    } catch (e) {
      console.error(`Error scanning ${dir}: ${e.message}`)
      process.exit(2)
    }

    let stripDir = path.dirname(dir);

    // Make sure "dir" ends with a / (or \ on windows)
    if (!stripDir.endsWith(path.sep)) {
      stripDir += path.sep;
    }

    return { dir, stripDir, paths };
  })

  let dataOffset = 0;
  let dataSize = 0;
  let headerSize = 4;
  const entries = [];
  dirInfos.forEach(({ stripDir, paths }) => {
    entries.push.apply(entries, paths.map(({ path, stats }) => {
      if (!path.startsWith(stripDir)) {
        console.error('MAJOR ISSUE: ', path, stripDir);
        process.exit(3);
      }

      let relPath = path.slice(stripDir.length);
      if (!isWindows()) {
        relPath = relPath.replace(/\//g, '\\');
      }
      headerSize += relPath.length + 1 + 4; // add room for filename, terminating 0 & filename length
      headerSize += 8; // add room for offset & size
      let offset = dataOffset;
      dataOffset += stats.size;
      dataSize += stats.size;
      return {
        path,
        relPath,
        offset,
        size: stats.size,
      }
    }))
  })

  // Now we know the size of the header, the size of the actual file data,
  // and the actual files to copy into the archive. Lets go!
  let buf = new Buffer.alloc(headerSize + dataSize);
  let dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 4;

  // Write file count first
  dv.setUint32(0, entries.length, true)

  // Write index of all files
  entries.forEach(e => {
    // Write name to archive index
    dv.setUint32(offset, e.relPath.length +1, true) // +1 for terminating zero (ASCIIZ, oldschool)
    offset += 4
    for (let i = 0; i < e.relPath.length; i++) {
      dv.setUint8(offset + i, e.relPath.charCodeAt(i))
    }
    offset += e.relPath.length
    dv.setUint8(offset++, 0) // Add terminating zero to make C happy

    // Now write file offset and size
    dv.setUint32(offset, e.offset + headerSize, true)
    dv.setUint32(offset + 4, e.size, true)
    offset += 8

    // Dump filename and size, to match up with extract
    // for manual verification
    console.log(e.relPath, e.size);
  })

  // Now go over all entries again and write the actual file data
  entries.forEach(e => {
    const data = fs.readFileSync(e.path)
    for (let i = 0; i < data.length; i++) {
      dv.setUint8(offset++, data[i]);
    }
  })

  fs.writeFileSync(archive, buf)
}

function extract(dir, archive, displayOnly = false) {
  // Read whole file in memory and setup for easy decoding
  const buf = fs.readFileSync(archive);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // Get our file index
  let count = dv.getUint32(0, true);
  let offset = 4;
  for (let i = 0; i < count; i++) {
    // Read filename from entry
    const nameLen = dv.getUint32(offset, true);
    let name = '';
    offset += 4;

    for (let j = 0; j < nameLen; j++) {
      let c = dv.getUint8(offset++);
      if (c != 0) {
        name += String.fromCharCode(c);
      }
    }

    // Get position and size of entry data
    const fileOffset = dv.getUint32(offset + 0, true);
    const fileSize = dv.getUint32(offset + 4, true);
    let fileName = name;
    offset += 8;

    if (!isWindows()) {
      // Switch \ to / for non-windows platforms,
      // so directories will be handled correctly
      fileName = fileName.replace(/\\/g, '/');
    }

    if (!displayOnly) {
      let fileBuf = null;
      if (dv.getUint32(fileOffset, true) === 0x0BADBEAF) {
        // file is compressed, decompress
        fileBuf = decompress(dv, fileOffset, fileSize);
      } else {
        // uncompressed, so copy out of buffer
        fileBuf = buf.slice(fileOffset, fileOffset + fileSize);
      }

      // Got the data, now dump it to disk
      const finalName = path.join(dir, fileName);
      mkdirp.sync(path.dirname(finalName));
      fs.writeFileSync(finalName, fileBuf);
    }

    // Print out the **original** filename, and the uncompressed size
    // (this is useful for comparing create/extract results)
    console.log(name, fileSize);
  }
}

function decompress(dv, off, size) {
  //let compressedSig = dv.getUint32(off + 0, true);
  let compressedSize = dv.getUint32(off + 4, true);
  let decompressedSize = dv.getUint32(off + 8, true);
  off += 12;

  let out = new Buffer.alloc(size);
  let outIdx = 0;

  let bytesLeft = decompressedSize;
  while (bytesLeft > 0) {
    let chunkBits = dv.getUint8(off++);
    for (let b = 0; b < 8; b++) {
      let flag = chunkBits & (1 << b);
      if (flag) {
        // Copy single byte
        let byte = dv.getUint8(off++);
        out[outIdx++] = byte;
        bytesLeft--;
      } else {
        let word = dv.getUint16(off, true);
        off += 2;
        if (word === 0) {
          break;
        }

        let count = (word >> 10);
        let offset = (word & 0x03FF);
        // Copy count+3 bytes staring at offset to the end of the decompression buffer,
        // as explained here: http://wiki.xentax.com/index.php?title=Darkstone
        for (let n = 0; n < count + 3; ++n) {
          out[outIdx] = out[outIdx - offset];
          ++outIdx;
          --bytesLeft;
        }

        if (bytesLeft < 0) {
          console.error("Compressed/decompressed size mismatch!", compressedSize, size, decompressedSize);
          return null;
        }
      }
    }
  }

  return out;
}
