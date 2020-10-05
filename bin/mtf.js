const fs = require('fs')
const path = require('path');
const mkdirp = require('mkdirp');

// Simple check to see if we are running on Windows
// (yes, this actually works on 64-bit windows too)
const isWindows = () => process.platform === "win32";

// allowed subcommands
const cmds = ["create", "extract"];

// Check arguments
if (process.argv.length < 5 ||
  cmds.indexOf(process.argv[2]) < 0) {
  console.warn(`Usage: mtf (${cmds.join("|")}) mtf-file path`)
  process.exit(1)
}

const cmd = process.argv[2];
const archive = process.argv[3];
const dir = process.argv[4];

// Check if input directory exists
if (cmd == 'create') {
  try {
    if (!fs.statSync(dir).isDirectory()) {
      console.error(`"${dir}" is not a directory!`)
      process.exit(2);
    }
  } catch (e) {
    console.log(`${dir}: ${e.message}`);
    process.exit(2);
  }

  // TODO: implement
  console.log('Sorry, not implemented yet!');
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
}

function extract(dir, archive) {
  // Read whole file in memory and setup for easy decoding
  const buf = fs.readFileSync(archive);
  console.log(buf);
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

    // Print out the **original** filename, and the uncompressed size
    // (this is useful for comparing create/extract results)
    console.log(name, fileSize);
  }
}

function decompress(dv, off, size) {
  //let compressedSig = dv.getUint32(off + 0, true);
  //let compressedSize = dv.getUint32(off + 4, true);
  //let decompressedSize = dv.getUint32(off + 8, true);
  off += 12;

  let out = new Buffer.alloc(size);
  let outIdx = 0;

  let bytesLeft = size;
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
          console.error("Compressed/decompressed size mismatch!");
          return null;
        }
      }
    }
  }

  return out;
}
