# Slider learns here (/learnspam, /learnham) with RSPAMD_PASSWORD – both for reading and changing.
# Unset, only Rspamd's own container may (secure_ip), so nothing is learned.
password = "{= env.PASSWORD|default('') =}";
enable_password = "{= env.PASSWORD|default('') =}";
# Never a file or shared memory named by the client.
allow_file_and_shm_inputs = false;
