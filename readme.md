# Acode ZipFS - a zip file system

This plugin adds support into Acode to read files directly from zip archives.

## New protocol: zip:

Paths starting with the zip: protocol (e.g. zip:/foo/bar.zip/index.js) will be resolved, the zip archive being extracted and opened as if it was a folder.
