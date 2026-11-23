# A recursive resolver of its own for Rspamd: DNS blocklists refuse the big public ones.
FROM alpine:3.24.4
# The root's trust anchor where unbound may update it (RFC 5011).
RUN apk add --no-cache unbound drill \
  && mkdir -p /var/lib/unbound \
  && (unbound-anchor -a /var/lib/unbound/root.key || true) \
  && chown -R unbound:unbound /var/lib/unbound
COPY unbound.conf /etc/unbound/unbound.conf
EXPOSE 53/udp 53/tcp
HEALTHCHECK --interval=30s --timeout=5s CMD drill -Q @127.0.0.1 rspamd.com > /dev/null || exit 1
CMD ["unbound", "-d", "-c", "/etc/unbound/unbound.conf"]
