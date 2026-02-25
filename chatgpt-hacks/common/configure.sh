#!/bin/bash
set -eu pipefail

ROOTDIR="$(pwd)"
VENV="${ROOTDIR}/venv"
PYDEPS="${ROOTDIR}/pydeps.txt"
MODELDEPS="${ROOTDIR}/modeldeps.txt"
VPYTHON="${VENV}/bin/python3"

[ -d "${VENV}" ] || mkdir -p "${VENV}"

echo "Creating venv in '${VENV}' and installing packages..."
python3 -m venv "${VENV}"

${VPYTHON} -m pip install --upgrade pip

if [ -f "${PYDEPS}" ] ; then
    ${VPYTHON} -m pip install -r "${PYDEPS}"
fi

if [ -f "${MODELDEPS}" ] ; then
    wget -N -l1 -nd -e robots=off -P ./models/ -i "${MODELDEPS}" || true
fi

echo "Done!"
