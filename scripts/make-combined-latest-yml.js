const fs = require('fs')
const path = require('path')
const yaml = require('js-yaml')

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'))
}

function pickFirstFile(info) {
  if (!info || !Array.isArray(info.files) || info.files.length === 0) return null
  const f = info.files[0]
  if (!f || !f.sha512 || !f.size) return null
  return { sha512: f.sha512, size: f.size }
}

const args = process.argv.slice(2)
const x64Yml = args[0]
const x64ExeName = args[1]
const ia32Yml = args[2]
const ia32ExeName = args[3]
const outYml = args[4]

if (!x64Yml || !x64ExeName || !ia32Yml || !ia32ExeName || !outYml) {
  process.exit(2)
}

const x64 = readYaml(x64Yml)
const ia32 = readYaml(ia32Yml)

const version = (x64 && x64.version) || (ia32 && ia32.version)
if (!version) process.exit(3)

const x64File = pickFirstFile(x64)
const ia32File = pickFirstFile(ia32)
if (!x64File || !ia32File) process.exit(4)

const out = {
  version,
  files: [
    { url: path.basename(x64ExeName), sha512: x64File.sha512, size: x64File.size },
    { url: path.basename(ia32ExeName), sha512: ia32File.sha512, size: ia32File.size },
  ],
  path: path.basename(x64ExeName),
  sha512: x64File.sha512,
  releaseDate: new Date().toISOString(),
}

fs.writeFileSync(outYml, yaml.dump(out), 'utf8')

