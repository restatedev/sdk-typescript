#!/bin/sh


CURRENT_PATH="$(pwd -P)";
SCRIPTPATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"

cd $SCRIPTPATH;
cd ..

rm -r src/generated
mkdir -p src/generated

protoc --plugin=./node_modules/.bin/protoc-gen-ts_proto \
       	--ts_proto_out=src/generated/ \
	--ts_proto_opt=outputSchema=true \
	--ts_proto_opt=env=node \
	--ts_proto_opt=esModuleInterop=true \
	--ts_proto_opt=lowerCaseServiceMethods=true \
	./proto/*
	
cd $CURRENT_PATH;

