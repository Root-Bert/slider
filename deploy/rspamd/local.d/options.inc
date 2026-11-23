# DNS only through the resolver beside it (rspamd-dns): DNS blocklists such as Spamhaus answer no
# public resolver (Google, Cloudflare …).
dns {
  nameserver = ["rspamd-dns:53"];
  timeout = 2s;
}
