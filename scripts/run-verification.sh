#!/usr/bin/env bash

#
# input parameters to this script, they all have defaults
#
export DRIVER_IMAGE=${DRIVER_IMAGE:-"ghcr.io/restatedev/e2e-verification-runner:main"}
export RESTATE_CONTAINER_IMAGE=${RESTATE_CONTAINER_IMAGE:-"ghcr.io/restatedev/restate:main"}
export SERVICES_CONTAINER_IMAGE=${SERVICES_CONTAINER_IMAGE:-"localhost/restatedev/test-services:latest"}
export ENV_FILE=${ENV_FILE:-"correctness/env.json"}
export PARAMS_FILE=${PARAMS_FILE:-"correctness/params.json"}

SEED=$(date --iso-8601=seconds)

#
# template a string file 
#
function template_json() {
	local tmpfile=$(mktemp)

	echo "local template=\$(cat <<-EOF" >> $tmpfile
	cat $1 >> $tmpfile
	echo "" >> $tmpfile
	echo "EOF" >> $tmpfile
	echo ")" >> $tmpfile

	source $tmpfile
	rm $tmpfile

	echo $template
}

function fix_path() {
	local file_path=$1

	if [ -f $file_path  ]; then
		echo $file_path
		return 0
	fi

	local script_dir=$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )
	local local_file_path="${script_dir}/${file_path}"

	if [ -f $local_file_path  ]; then
		echo $local_file_path
		return 0
	fi
	
	echo "could not find ${file_path} or ${local_file_path}"
	exit 1

}

docker pull ${DRIVER_IMAGE}
docker pull ${RESTATE_CONTAINER_IMAGE}

# log configuration parameters
echo "Driver ================================================"
echo ${DRIVER_IMAGE}
docker inspect ${DRIVER_IMAGE} | grep org.opencontainers.image.revision

echo "RESTATE ================================================"
echo ${RESTATE_CONTAINER_IMAGE}
docker inspect ${RESTATE_CONTAINER_IMAGE} | grep org.opencontainers.image.revision

echo "SERVICE ================================================"
echo ${SERVICES_CONTAINER_IMAGE}
docker inspect ${SERVICES_CONTAINER_IMAGE} | grep org.opencontainers.image.revision

echo "======================================================="

export ENV_FILE=$(fix_path ${ENV_FILE})
export PARAMS_FILE=$(fix_path ${PARAMS_FILE})

echo ${ENV_FILE}
echo ${PARAMS_FILE}

#
# The following ENV is needed for the driver program itself.
#

export INTERPRETER_DRIVER_CONF=$(template_json ${PARAMS_FILE})
export UNIVERSE_ENV_JSON=$(template_json ${ENV_FILE})
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
