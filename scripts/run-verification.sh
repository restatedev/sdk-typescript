#!/usr/bin/env bash

export SERVICES_CONTAINER_IMAGE=${SERVICES_CONTAINER_IMAGE:-"localhost/restatedev/test-services:latest"}

# WORKS: -------------------------------------------------------------------------------------------------------------------------------------
# restate commit: 41c72c04e4e91f305f86fa2067f356e72a5e2312 
# export RESTATE_CONTAINER_IMAGE="ghcr.io/restatedev/restate@sha256:0a0649fb552b6755299d579ff17bad44febb5339351b20f0fa50f0561bd17ff8"
# export DRIVER_IMAGE="ghcr.io/restatedev/e2e-verification-runner@sha256:c59d236243c0cd3e500367d8aa6fdc0f057ef389f1668d502b6c15601216f7b6"
# --------------------------------------------------------------------------------------------------------------------------------------------------


# WORKS: -------------------------------------------------------------------------------------------------------------------------------------
# restate commit: abf1b7f
# export RESTATE_CONTAINER_IMAGE="ghcr.io/restatedev/restate@sha256:1d70df6a53982ee047b3e82078c5c8dffb33a3d783b6d9dca4f345be2eb0dfc2"
# export DRIVER_IMAGE="ghcr.io/restatedev/e2e-verification-runner@sha256:c59d236243c0cd3e500367d8aa6fdc0f057ef389f1668d502b6c15601216f7b6"
# MAYBE WORKS: -------------------------------------------------------------------------------------------------------------------------------------
#

# DIDNT WORK (main but without atomic commit) ------------------------------------------------------------------------------------------------
# export RESTATE_CONTAINER_IMAGE="ghcr.io/restatedev/restate@sha256:3c915915a6b13108cfe486a0bd534da5a61bdbe0ed81425426d93cdb9f13cd26"
# export DRIVER_IMAGE="ghcr.io/restatedev/e2e-verification-runner@sha256:c59d236243c0cd3e500367d8aa6fdc0f057ef389f1668d502b6c15601216f7b6"
# DIDNT WORK (main but without atomic commit) ------------------------------------------------------------------------------------------------


# MAYBE WORKS ------------------------------------
# commit: https://github.com/restatedev/restate/commit/0ac0d580b813d64c73231924f3eb6cd26ebdc4cd
export RESTATE_CONTAINER_IMAGE="ghcr.io/restatedev/restate@sha256:de8a315c98e3c80507d9b70311a7c42e0a328cd5c993bbda83592b6885df9d14"
export DRIVER_IMAGE="ghcr.io/restatedev/e2e-verification-runner@sha256:c59d236243c0cd3e500367d8aa6fdc0f057ef389f1668d502b6c15601216f7b6"

SEED=$(date --iso-8601=seconds)

#	"crashInterval"		: 900000,
# "tests" : 1000000,
#"tests" : 1000000,

export INTERPRETER_DRIVER_CONF=$(cat <<-EOF
{
	"seed"	: "${SEED}",
	"keys"	: 100000,
	"tests" : 1000000,
	"maxProgramSize"	:  20,
	"bootstrap"				: true,
	"crashInterval"		: 900000
}
EOF
)

#      "RESTATE_METADATA_STORE__TYPE": "embedded",
#      "RESTATE_ALLOW_BOOTSTRAP": "true",

echo "commit: "

git rev-parse HEAD

echo $DRIVER_IMAGE
echo $RESTATE_CONTAINER_IMAGE
echo $SERVICES_CONTAINER_IMAGE

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
			"RESTATE_ADVERTISED_ADDRESS": "http://n1:5122",
      "RESTATE_ALLOW_BOOTSTRAP": "true",
			"RUST_BACKTRACE" : "1",
      "DO_NOT_TRACK": "true"
    }
  },
  "n2": {
    "image": "${RESTATE_CONTAINER_IMAGE}",
    "ports": [8080],
    "pull": "always",
    "env": {
      "RESTATE_ADVERTISED_ADDRESS": "http://n2:5122",
      "RESTATE_LOG_FILTER": "restate=warn",
      "RESTATE_LOG_FORMAT": "json",
      "RESTATE_ROLES": "[worker,admin,log-server]",
      "RESTATE_CLUSTER_NAME": "foobar",
      "RESTATE_BIFROST__DEFAULT_PROVIDER": "replicated",
      "RESTATE_BIFROST__REPLICATED_LOGLET__DEFAULT_REPLICATION_PROPERTY": "2",
      "RESTATE_ALLOW_BOOTSTRAP": "false",
			"RUST_BACKTRACE" : "1",
      "DO_NOT_TRACK": "true",
			"RESTATE_METADATA_STORE_CLIENT__ADDRESS" : "http://n1:5122"
    }
  },
  "n3": {
    "image": "${RESTATE_CONTAINER_IMAGE}",
    "ports": [8080],
    "pull": "always",
		"env": {
      "RESTATE_ADVERTISED_ADDRESS": "http://n3:5122",
      "RESTATE_LOG_FILTER": "restate=warn",
      "RESTATE_LOG_FORMAT": "json",
      "RESTATE_ROLES": "[worker,admin,log-server]",
      "RESTATE_CLUSTER_NAME": "foobar",
      "RESTATE_BIFROST__DEFAULT_PROVIDER": "replicated",
      "RESTATE_BIFROST__REPLICATED_LOGLET__DEFAULT_REPLICATION_PROPERTY": "2",
      "RESTATE_ALLOW_BOOTSTRAP": "false",
			"RUST_BACKTRACE" : "1",
      "DO_NOT_TRACK": "true",
			"RESTATE_METADATA_STORE_CLIENT__ADDRESS": "http://n1:5122"
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
			"UV_THREADPOOL_SIZE" : "8",
			"NODE_OPTS" : "--max-old-space-size=4096",
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
			"UV_THREADPOOL_SIZE" : "8",
			"NODE_OPTS" : "--max-old-space-size=4096",
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
			"UV_THREADPOOL_SIZE" : "8",
			"NODE_OPTS" : "--max-old-space-size=4096",
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
			"UV_THREADPOOL_SIZE" : "8",
			"NODE_OPTS" : "--max-old-space-size=4096",
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
export NODE_OPTIONS="--max-old-space-size=8196"
export AWS_LAMBDA_FUNCTION_NAME=1
export DEBUG=testcontainers:containers

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
	--env UNIVERSE_ENV_JSON \
	${DRIVER_IMAGE}
