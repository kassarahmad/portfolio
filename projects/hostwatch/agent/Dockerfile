# The agent is meant to run on the host itself (see hostwatch-agent.service).
# This image is for demos: with HOSTWATCH_SIMULATE=1 it sends labelled, simulated data.
FROM python:3.12-alpine
RUN adduser -D -H agent
WORKDIR /agent
COPY hostwatch_agent.py .
USER agent
CMD ["python3", "-u", "hostwatch_agent.py"]
