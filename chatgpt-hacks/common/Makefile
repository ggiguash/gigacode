WGET_CMD:=wget -N -l1 -nd -e robots=off -P ./data/

all:
	@echo "Usage: make <config | run | clean | get URL=url | getall URL=url>"

config:
	../common/configure.sh
	@mkdir -p ./data

get:
	@rm -rf data storage
	$(WGET_CMD) "$(URL)"

getall:
	@rm -rf data storage
	$(WGET_CMD) -r "$(URL)"

run:
	@find ./data -type f -exec file {} \; | grep -Ev ' text|PDF document' | awk -F: '{print $$1}' | xargs -n1 rm -f
	@du -sh ./data
	@./venv/bin/python main.py

clean:
	@rm -rf venv data storage models
