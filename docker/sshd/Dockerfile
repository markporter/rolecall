FROM alpine:3.20
RUN apk add --no-cache openssh && adduser -D rolecalltest && mkdir -p /home/rolecalltest/.ssh && chown -R rolecalltest:rolecalltest /home/rolecalltest/.ssh && ssh-keygen -A
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/entrypoint.sh"]
