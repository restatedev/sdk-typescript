#!/bin/sh

#
# The following script will use protobufjs-cli to statically generate a .js file with 
# type script type definitions. 
#

CURRENT_PATH="$(pwd -P)";
SCRIPTPATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"

cd $SCRIPTPATH;
cd ..

PBJS="./node_modules/protobufjs-cli/bin/pbjs"
PBTS="./node_modules/protobufjs-cli/bin/pbts"



for path in ./proto/*.proto; do
	filename=$(basename "$path" .proto)

	echo "generating ${filename} ..."
	$PBJS -t static-module -w commonjs -o src/generated/${filename}.js $path 
	$PBTS -o src/generated/${filename}.d.ts src/generated/${filename}.js
	echo "done."
done

cd $CURRENT_PATH;
