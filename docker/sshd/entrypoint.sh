#!/bin/sh
set -e
if [ -n "$AUTHORIZED_KEY" ]; then echo "$AUTHORIZED_KEY" > /home/rolecalltest/.ssh/authorized_keys; chown rolecalltest:rolecalltest /home/rolecalltest/.ssh/authorized_keys; chmod 600 /home/rolecalltest/.ssh/authorized_keys; fi
ssh-keygen -A
exec /usr/sbin/sshd -D -e
