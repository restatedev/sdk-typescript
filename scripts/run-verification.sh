#!/usr/bin/env bash


export RESTATE_CONTAINER_IMAGE=${RESTATE_CONTAINER_IMAGE:-"ghcr.io/restatedev/restate:main"}
export SERVICES_CONTAINER_IMAGE=${SERVICES_CONTAINER_IMAGE:-"localhost/restatedev/test-services:latest"}

export SERVICES=InterpreterDriverJob
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=4096"
export AWS_LAMBDA_FUNCTION_NAME=1
export DEBUG=testcontainers:containers

SEED=$(date --iso-8601=seconds)

export INTERPRETER_DRIVER_CONF=$(cat <<-EOF
{
	"seed"	: "${SEED}",
	"keys"	: 100000,
	"tests" : 1000000,
	"maxProgramSize"	:  20,
	"crashInterval"		: 900000,
	"bootstrap"				: true
}
EOF
)

echo $RESTATE_CONTAINER_IMAGE

docker pull ghcr.io/restatedev/e2e-verification-runner:main

docker run \
	--net host\
	-v /var/run/docker.sock:/var/run/docker.sock	\
	--env RESTATE_CONTAINER_IMAGE \
	--env SERVICES_CONTAINER_IMAGE \
	--env SERVICES	\
	--env NODE_ENV \
	--env NODE_OPTIONS \
	--env AWS_LAMBDA_FUNCTION_NAME \
	--env DEBUG \
	--env INTERPRETER_DRIVER_CONF \
	ghcr.io/restatedev/e2e-verification-runner:main 2>&1 | grep -v "undefined is not a number, but it still has feelings"

