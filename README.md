# Darkstone Tools

This repository contains [Darkstone](https://wikipedia.org/wiki/Darkstone) modding tools. You can install them using [NodeJS](https://nodejs.org) npm by using:

    npm install -g @game3dee/darkstone-tools

Rerun the command to update to the latest release. If you're feeling experimental, and want the bleeding edge, you can use:

    npm install -g Game3DEE/darkstone-tools

See below for a list of tools included.

## MTF

This tool enables you to list the content of an MTF file, extract MTF files, and create them. Please note that currently compression is not supported, so if you extract and recreate an MTF file, it'll likely be much bigger.

List:

    mtf list ddata.MTF

Extraction:

    mtf extract myquest.mtf /path/where/I/unpack

Creation:

    mtf create mynewshiny.mtf /path/from/where/I/pack/DATA

#### More to come...
