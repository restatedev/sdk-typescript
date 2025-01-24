#!/usr/bin/env bash

export DRIVER_IMAGE=${DRIVER_IMAGE:-"ghcr.io/restatedev/e2e-verification-runner:main"}
export RESTATE_CONTAINER_IMAGE=${RESTATE_CONTAINER_IMAGE:-"ghcr.io/restatedev/restate:main"}
export SERVICES_CONTAINER_IMAGE=${SERVICES_CONTAINER_IMAGE:-"ghcr.io/restatedev/test-services:node140"}


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


export UNIVERSE_ENV_JSON=$(cat <<-EOF
{
  "n1": {
    "image": "${RESTATE_CONTAINER_IMAGE}",
    "ports": [8080, 9070, 5122],
    "pull": "always",
    "env": {
      "RESTATE_LOG_FILTER": "restate=warn",
      "RESTATE_LOG_FORMAT": "json",
      "RESTATE_ROLES": "[worker,log-server,admin,metadata-store]",
      "RESTATE_CLUSTER_NAME": "foobar",
      "RESTATE_BIFROST__DEFAULT_PROVIDER": "replicated",
      "RESTATE_BIFROST__REPLICATED_LOGLET__DEFAULT_REPLICATION_PROPERTY": "2",
      "RESTATE_METADATA_STORE__TYPE": "embedded",
      "RESTATE_ALLOW_BOOTSTRAP": "true",
      "RESTATE_ADVERTISED_ADDRESS": "http://n1:5122",
      "DO_NOT_TRACK": "true"
    }
  },
  "n2": {
    "image": "${RESTATE_CONTAINER_IMAGE}",
    "ports": [8080],
    "pull": "always",
    "env": {
      "RESTATE_LOG_FILTER": "restate=warn",
      "RESTATE_LOG_FORMAT": "json",
      "RESTATE_ROLES": "[worker,admin,log-server, metadata-store]",
      "RESTATE_CLUSTER_NAME": "foobar",
      "RESTATE_BIFROST__DEFAULT_PROVIDER": "replicated",
      "RESTATE_BIFROST__REPLICATED_LOGLET__DEFAULT_REPLICATION_PROPERTY": "2",
      "RESTATE_METADATA_STORE_CLIENT__TYPE": "embedded",
      "RESTATE_ALLOW_BOOTSTRAP": "false",
      "RESTATE_METADATA_STORE_CLIENT__ADDRESSES": "[http://n1:5122]",
      "RESTATE_ADVERTISED_ADDRESS": "http://n2:5122",
      "DO_NOT_TRACK": "true"
    }
  },
  "n3": {
    "image": "${RESTATE_CONTAINER_IMAGE}",
    "ports": [8080],
    "pull": "always",
    "env": {
      "RESTATE_LOG_FILTER": "restate=warn",
      "RESTATE_LOG_FORMAT": "json",
      "RESTATE_ROLES": "[worker,admin,log-server, metadata-store]",
      "RESTATE_CLUSTER_NAME": "foobar",
      "RESTATE_BIFROST__DEFAULT_PROVIDER": "replicated",
      "RESTATE_BIFROST__REPLICATED_LOGLET__DEFAULT_REPLICATION_PROPERTY": "2",
      "RESTATE_METADATA_STORE_CLIENT__TYPE": "embedded",
      "RESTATE_ALLOW_BOOTSTRAP": "false",
      "RESTATE_METADATA_STORE_CLIENT__ADDRESSES": "[http://n1:5122]",
      "RESTATE_ADVERTISED_ADDRESS": "http://n3:5122",
      "DO_NOT_TRACK": "true"
    }
  },
  "interpreter_zero": {
    "image": "${SERVICES_CONTAINER_IMAGE}",
    "ports": [9000],
    "pull": "never",
    "env": {
      "PORT": "9000",
      "RESTATE_LOGGING": "ERROR",
      "NODE_ENV": "production",
      "SERVICES": "ObjectInterpreterL0"
    }
  },
  "interpreter_one": {
    "image": "${SERVICES_CONTAINER_IMAGE}",
    "ports": [9001],
    "pull": "never",
    "env": {
      "PORT": "9001",
      "RESTATE_LOGGING": "ERROR",
      "NODE_ENV": "production",
      "SERVICES": "ObjectInterpreterL1"
    }
  },
  "interpreter_two": {
    "image": "${SERVICES_CONTAINER_IMAGE}",
    "ports": [9002],
    "pull": "never",
    "env": {
      "PORT": "9002",
      "RESTATE_LOGGING": "ERROR",
      "NODE_ENV": "production",
      "SERVICES": "ObjectInterpreterL2"
    }
  },
  "services": {
    "image": "${SERVICES_CONTAINER_IMAGE}",
    "ports": [9003],
    "pull": "never",
    "env": {
      "PORT": "9003",
      "RESTATE_LOGGING": "ERROR",
      "NODE_ENV": "production",
      "SERVICES": "ServiceInterpreterHelper"
    }
  }
}
EOF
)


docker pull ${DRIVER_IMAGE}

#
# The following ENV is needed for the driver program itself.
#
export SERVICES=InterpreterDriverJob
export NODE_ENV=production
export NODE_OPTIONS="--max-old-space-size=4096"
export AWS_LAMBDA_FUNCTION_NAME=1
export DEBUG=testcontainers:containers

docker run \
	--net host\
	-v /var/run/docker.sock:/var/run/docker.sock	\
	--env SERVICES	\
	--env NODE_ENV \
	--env NODE_OPTIONS \
	--env AWS_LAMBDA_FUNCTION_NAME \
	--env DEBUG \
	--env INTERPRETER_DRIVER_CONF \
	--env UNIVERSE_ENV_JSON \
	${DRIVER_IMAGE}

