export const DEFAULT_SNAPSERVER_CONF = `###############################################################################
#     ______                                                                  #
#    / _____)                                                                 #
#   ( (____   ____   _____  ____    ___  _____   ____  _   _  _____   ____    #
#    \\____ \\ |  _ \\ (____ ||  _ \\  /___)| ___ | / ___)| | | || ___ | / ___)   #
#    _____) )| | | |/ ___ || |_| ||___ || ____|| |     \\ V / | ____|| |       #
#   (______/ |_| |_|\\_____||  __/ (___/ |_____)|_|      \\_/  |_____)|_|       #
#                          |_|                                                #
#                                                                             #
#  Snapserver config file                                                     #
#                                                                             #
###############################################################################

# default values are commented
# uncomment and edit to change them

# Settings can be overwritten on command line with:
#  "--<section>.<name>=<value>", e.g. --server.threads=4


# General server settings #####################################################
#
[server]
# Number of additional worker threads to use
# - For values < 0 the number of threads will be 2 (on single and dual cores)
#   or 4 (for quad and more cores)
# - 0 will utilize just the processes main thread and might cause audio drops
#   in case there are a couple of longer running tasks, such as encoding
#   multiple audio streams
#threads = -1

# the pid file when running as daemon (-d or --daemon)
#pidfile = /var/run/snapserver/pid

# the user to run as when daemonized (-d or --daemon)
#user = snapserver
# the group to run as when daemonized (-d or --daemon)
#group = snapserver

# directory where persistent data is stored (server.json)
# if empty, data dir will be
#  - "/var/lib/snapserver/" when running as daemon
#  - "$HOME/.config/snapserver/" when not running as daemon
#datadir =

# enable mDNS to publish services
#mdns_enabled = true
#
###############################################################################


# Secure Socket Layer #########################################################
#
[ssl]
# Certificate files are either specified by their full or relative path. Certificates with
# relative path are searched for in the current path and in "/etc/snapserver/certs"

# Certificate file in PEM format
#certificate =

# Private key file in PEM format
#certificate_key =

# Password for decryption of the certificate_key (only needed for encrypted certificate_key file)
#key_password =

# Verify client certificates
#verify_clients = false

# List of client CA certificate files, can be configured multiple times
#client_cert =
#client_cert =
#
###############################################################################


# HTTP RPC ####################################################################
#
[http]
# enable HTTP Control and streaming (HTTP POST and websockets)
#enabled = true

# address to listen on, can be specified multiple times
# use "0.0.0.0" to bind to any IPv4 address or :: to bind to any IPv6 address
# or "127.0.0.1" or "::1" to bind to localhost IPv4 or IPv6, respectively
# use the address of a specific network interface to just listen on and accept
# connections from that interface
#bind_to_address = ::

# which port the server should listen on
#port = 1780

# Publish HTTP service via mDNS as '_snapcast-http._tcp'
#publish_http = true

# enable HTTPS Json RPC (HTTPS POST and ssl websockets)
#ssl_enabled = false

# same as 'bind_to_address' but for SSL
#ssl_bind_to_address = ::

# same as 'port' but for SSL
#ssl_port = 1788

# Publish HTTPS service via mDNS as '_snapcast-https._tcp'
#publish_https = true

# serve a website from the doc_root location
# disabled if commented or empty
doc_root = /usr/share/snapserver/snapweb

# Hostname or IP under which clients can reach this host
# used to serve cached cover art
# use <hostname> as placeholder for your actual host name
#host = <hostname>

# Optional custom URL prefix for generated URLs where clients can reach
# cached album art, to e.g. match scheme behind a reverse proxy.
#url_prefix = https://<hostname>
#
###############################################################################


# TCP #########################################################################
#
[tcp-control]
# enable TCP Json RPC
#enabled = true

# address to listen on, can be specified multiple times
# use "0.0.0.0" to bind to any IPv4 address or :: to bind to any IPv6 address
# or "127.0.0.1" or "::1" to bind to localhost IPv4 or IPv6, respectively
# use the address of a specific network interface to just listen on and accept
# connections from that interface
#bind_to_address = ::

# which port the control server should listen on
#port = 1705

# Publish TCP control service via mDNS as '_snapcast-ctrl._tcp'
#publish = true

[tcp-streaming]
# enable TCP streaming
#enabled = true

# address to listen on, can be specified multiple times
# use "0.0.0.0" to bind to any IPv4 address or :: to bind to any IPv6 address
# or "127.0.0.1" or "::1" to bind to localhost IPv4 or IPv6, respectively
# use the address of a specific network interface to just listen on and accept
# connections from that interface
#bind_to_address = ::

# which port the streaming server should listen on
#port = 1704

# Publish TCP streaming service via mDNS as '_snapcast._tcp'
#publish = true
#
###############################################################################


# Stream settings #############################################################
#
[stream]
# source URI of the PCM input stream, can be configured multiple times
# The following notation is used in this paragraph:
#  <angle brackets>: the whole expression must be replaced with your specific setting
# [square brackets]: the whole expression is optional and can be left out
# [key=value]: if you leave this option out, "value" will be the default for "key"
#
# Format: TYPE://host/path?name=<name>[&codec=<codec>][&sampleformat=<sampleformat>][&chunk_ms=<chunk ms>][&controlscript=<control script filename>[&controlscriptparams=<control script command line arguments>]]
#  parameters have the form "key=value", they are concatenated with an "&" character
#  parameter "name" is mandatory for all sources, while codec, sampleformat and chunk_ms are optional
#  and will override the default codec, sampleformat or chunk_ms settings
# Available types are:
# pipe: pipe:///<path/to/pipe>?name=<name>[&mode=create], mode can be "create" or "read"
# librespot: librespot:///<path/to/librespot>?name=<name>[&username=<my username>&password=<my password>][&devicename=Snapcast][&bitrate=320][&wd_timeout=7800][&volume=100][&onevent=""][&normalize=false][&autoplay=false][&params=<generic librepsot process arguments>]
#  note that you need to have the librespot binary on your machine
#  sampleformat will be set to "44100:16:2"
# file: file:///<path/to/PCM/file>?name=<name>
# process: process:///<path/to/process>?name=<name>[&wd_timeout=0][&log_stderr=false][&params=<process arguments>]
# airplay: airplay:///<path/to/airplay>?name=<name>[&port=5000]
#  note that you need to have the airplay binary on your machine
#  sampleformat will be set to "44100:16:2"
# tcp server: tcp://<listen IP, e.g. 127.0.0.1>:<port>?name=<name>[&mode=server]
# tcp client: tcp://<server IP, e.g. 127.0.0.1>:<port>?name=<name>&mode=client
# alsa: alsa:///?name=<name>&device=<alsa device>[&send_silence=false][&idle_threshold=100][&silence_threshold_percent=0.0]
# meta: meta:///<name of source#1>/<name of source#2>/.../<name of source#N>?name=<name>
source = pipe:///tmp/snapfifo?name=default

# The name of the default source for new clients to connect to
# Otherwise defaults to first non-meta source
# default_source = default

# Plugin directory, containing scripts, referred by "controlscript"
#plugin_dir = /usr/share/snapserver/plug-ins

# Sandbox directory, containing executables, started by "process" and "librespot" streams
#sandbox_dir = /usr/share/snapserver/sandbox

# Default sample format: <sample rate>:<bits per sample>:<channels>
#sampleformat = 48000:16:2

# Default transport codec
# (flac|ogg|opus|pcm)[:options]
# Start Snapserver with "--stream:codec=<codec>:?" to get codec specific options
#codec = flac

# Default source stream read chunk size [ms].
# The server will continously read this number of milliseconds from the source into buffer and pass this buffer to the encoder.
# The encoded buffer is sent to the clients. Some codecs have a higher latency and will need more data, e.g. Flac will need ~26ms chunks
#chunk_ms = 20

# Buffer [ms]
# The end-to-end latency, from capturing a sample on the server until the sample is played-out on the client
#buffer = 1000

# Send audio to muted clients
#send_to_muted = false
#
###############################################################################


# Streaming client options ####################################################
#
[streaming_client]

# Volume assigned to new snapclients [percent]
# Defaults to 100 if unset
#initial_volume = 100
#
###############################################################################


# Logging options #############################################################
#
[logging]

# log sink [null,system,stdout,stderr,file:<filename>]
# when left empty: if running as daemon "system" else "stdout"
#sink =

# log filter <tag>:<level>[,<tag>:<level>]*
# with tag = * or <log tag> and level = [trace,debug,info,notice,warning,error,fatal]
#filter = *:info
#
###############################################################################
`;

export const CONFIG_METADATA: Record<string, any> = {
  server: {
    threads: { label: "Worker Threads", type: "number", default: -1, description: "Additional worker threads. -1 = auto (2 on dual-core, 4 on quad+). 0 = main thread only." },
    pidfile: { label: "PID File", type: "text", default: "/var/run/snapserver/pid", description: "Path to the PID file when running as daemon." },
    user: { label: "User", type: "text", default: "snapserver", description: "The system user to run as when daemonized." },
    group: { label: "Group", type: "text", default: "snapserver", description: "The system group to run as when daemonized." },
    datadir: { label: "Data Directory", type: "text", description: "Directory for persistent data (server.json). Empty = /var/lib/snapserver/ (daemon) or ~/.config/snapserver/ (non-daemon)." },
    mdns_enabled: { label: "mDNS", type: "boolean", default: "true", description: "Publish services via mDNS for auto-discovery." },
  },
  ssl: {
    certificate: { label: "Certificate", type: "text", description: "Certificate file path in PEM format. Relative paths search /etc/snapserver/certs." },
    certificate_key: { label: "Private Key", type: "text", description: "Private key file path in PEM format." },
    key_password: { label: "Key Password", type: "text", description: "Password to decrypt the private key (only for encrypted key files)." },
    verify_clients: { label: "Verify Clients", type: "boolean", default: "false", description: "Require client certificate verification for mutual TLS." },
    client_cert: { label: "Client CA Certs", type: "list", description: "List of client CA certificate files for client verification." },
  },
  http: {
    enabled: { label: "HTTP Enabled", type: "boolean", default: "true", description: "Enable HTTP control, JSON-RPC (POST), and WebSocket streaming." },
    bind_to_address: { label: "Bind Address", type: "text", default: "::", description: "Listen address. Use 0.0.0.0 (IPv4), :: (IPv6), or 127.0.0.1 (localhost only)." },
    port: { label: "Port", type: "number", default: 1780, description: "HTTP listening port." },
    publish_http: { label: "Publish HTTP (mDNS)", type: "boolean", default: "true", description: "Advertise HTTP service via mDNS as _snapcast-http._tcp." },
    ssl_enabled: { label: "SSL Enabled", type: "boolean", default: "false", description: "Enable HTTPS/WSS for encrypted JSON-RPC and streaming." },
    ssl_bind_to_address: { label: "SSL Bind Address", type: "text", default: "::", description: "Listen address for HTTPS connections." },
    ssl_port: { label: "SSL Port", type: "number", default: 1788, description: "HTTPS listening port." },
    publish_https: { label: "Publish HTTPS (mDNS)", type: "boolean", default: "true", description: "Advertise HTTPS service via mDNS as _snapcast-https._tcp." },
    doc_root: { label: "Document Root", type: "text", default: "/usr/share/snapserver/snapweb", description: "Directory to serve a web UI from. Leave empty to disable." },
    host: { label: "Hostname", type: "text", description: "Hostname/IP for clients to reach this server (used for cover art URLs). Use <hostname> as placeholder." },
    url_prefix: { label: "URL Prefix", type: "text", description: "Custom URL prefix for generated URLs (e.g. behind a reverse proxy). Example: https://<hostname>" },
  },
  "tcp-control": {
    enabled: { label: "Enabled", type: "boolean", default: "true", description: "Enable TCP JSON-RPC control interface." },
    bind_to_address: { label: "Bind Address", type: "text", default: "::", description: "Listen address for TCP control connections." },
    port: { label: "Port", type: "number", default: 1705, description: "TCP control interface port." },
    publish: { label: "mDNS Publish", type: "boolean", default: "true", description: "Advertise TCP control via mDNS as _snapcast-ctrl._tcp." },
  },
  "tcp-streaming": {
    enabled: { label: "Enabled", type: "boolean", default: "true", description: "Enable TCP audio streaming." },
    bind_to_address: { label: "Bind Address", type: "text", default: "::", description: "Listen address for TCP streaming connections." },
    port: { label: "Port", type: "number", default: 1704, description: "TCP streaming port." },
    publish: { label: "mDNS Publish", type: "boolean", default: "true", description: "Advertise TCP streaming via mDNS as _snapcast._tcp." },
  },
  stream: {
    source: { label: "Audio Sources", type: "list", description: "Input stream URIs. Use the Add Source button for guided setup." },
    default_source: { label: "Default Source", type: "text", description: "Default source name for new clients. If empty, first non-meta source is used." },
    sampleformat: { label: "Sample Format", type: "text", default: "48000:16:2", description: "Default format: <sample rate>:<bits per sample>:<channels>." },
    codec: { label: "Codec", type: "select", default: "flac", options: ["flac", "ogg", "opus", "pcm"], description: "Transport codec. flac=lossless (~26ms), ogg=lossy, opus=low-latency (48kHz only), pcm=uncompressed." },
    chunk_ms: { label: "Chunk Size (ms)", type: "number", default: 20, description: "How many milliseconds to read from source per cycle before encoding." },
    buffer: { label: "Buffer (ms)", type: "number", default: 1000, description: "End-to-end latency from server capture to client playback." },
    send_to_muted: { label: "Send to Muted", type: "boolean", default: "false", description: "Still send audio data to muted clients (uses more bandwidth)." },
    plugin_dir: { label: "Plugin Directory", type: "text", default: "/usr/share/snapserver/plug-ins", description: "Directory for control scripts referenced by 'controlscript' parameter." },
    sandbox_dir: { label: "Sandbox Directory", type: "text", default: "/usr/share/snapserver/sandbox", description: "Directory for executables started by 'process' and 'librespot' sources." },
  },
  streaming_client: {
    initial_volume: { label: "Initial Volume", type: "number", default: 100, description: "Volume (0-100%) assigned to brand-new clients on first connect." },
  },
  logging: {
    sink: { label: "Log Sink", type: "select", default: "", options: ["", "null", "system", "stdout", "stderr"], description: "Log output destination. Empty = 'system' (daemon) or 'stdout' (non-daemon). Use file:<path> for file logging." },
    filter: { label: "Log Filter", type: "text", default: "*:info", description: "Filter format: <tag>:<level>[,...]. Tags: * or specific. Levels: trace, debug, info, notice, warning, error, fatal." },
  }
};

// Section display configuration
export const CONFIG_SECTIONS: Record<string, { label: string; icon: string; description: string }> = {
  server:           { label: "Server",           icon: "server",    description: "General server settings like threads, user, and mDNS" },
  ssl:              { label: "SSL / TLS",        icon: "lock",      description: "Certificate and encryption settings for secure connections" },
  http:             { label: "HTTP / WebSocket",  icon: "globe",     description: "HTTP/HTTPS and WebSocket control and streaming" },
  "tcp-control":    { label: "TCP Control",      icon: "terminal",  description: "TCP JSON-RPC control interface" },
  "tcp-streaming":  { label: "TCP Streaming",    icon: "signal",    description: "TCP raw audio streaming" },
  stream:           { label: "Stream",           icon: "music",     description: "Audio sources, codecs, and buffer settings" },
  streaming_client: { label: "Clients",          icon: "users",     description: "Default settings for streaming clients" },
  logging:          { label: "Logging",          icon: "file-text",  description: "Log output and filtering" },
};

// Source type templates for guided source creation
export interface SourceParam {
  key: string;
  label: string;
  description: string;
  required: boolean;
  type: 'text' | 'number' | 'boolean' | 'select';
  default?: string;
  options?: string[];
  placeholder?: string;
}

export interface SourceTemplate {
  type: string;
  label: string;
  description: string;
  uriPrefix: string;
  pathPlaceholder: string;
  fixedSampleFormat?: string;
  isMeta?: boolean;
  params: SourceParam[];
}

export const SOURCE_TEMPLATES: SourceTemplate[] = [
  {
    type: "pipe",
    label: "Pipe (FIFO)",
    description: "Read audio from a named pipe. Use with MPD, Mopidy, FFmpeg, mpv, PulseAudio, Plexamp, etc.",
    uriPrefix: "pipe://",
    pathPlaceholder: "/tmp/snapfifo",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "default" },
      { key: "mode", label: "Mode", description: "Pipe creation mode", required: false, type: "select", default: "create", options: ["create", "read"] },
      { key: "codec", label: "Codec", description: "Override default codec for this source", required: false, type: "select", options: ["flac", "ogg", "opus", "pcm"] },
      { key: "sampleformat", label: "Sample Format", description: "Override default sample format (rate:bits:channels)", required: false, type: "text", placeholder: "48000:16:2" },
    ],
  },
  {
    type: "librespot",
    label: "Spotify (librespot)",
    description: "Launch librespot for Spotify Connect. Requires librespot binary. Fixed at 44100:16:2.",
    uriPrefix: "librespot://",
    pathPlaceholder: "/usr/bin/librespot",
    fixedSampleFormat: "44100:16:2",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "Spotify" },
      { key: "username", label: "Username", description: "Spotify username (optional for zeroconf)", required: false, type: "text" },
      { key: "password", label: "Password", description: "Spotify password", required: false, type: "text" },
      { key: "devicename", label: "Device Name", description: "Name shown in Spotify Connect", required: false, type: "text", default: "Snapcast" },
      { key: "bitrate", label: "Bitrate", description: "Audio quality", required: false, type: "select", default: "320", options: ["96", "160", "320"] },
      { key: "volume", label: "Initial Volume", description: "Volume 0-100 on connect", required: false, type: "number", default: "100" },
      { key: "normalize", label: "Normalize Volume", description: "Enable volume normalization", required: false, type: "boolean", default: "false" },
      { key: "autoplay", label: "Autoplay", description: "Auto-play similar songs when queue ends", required: false, type: "boolean", default: "false" },
      { key: "cache", label: "Cache Dir", description: "Directory for cached audio files", required: false, type: "text" },
      { key: "disable_audio_cache", label: "Disable Audio Cache", description: "Don't cache downloaded audio to disk", required: false, type: "boolean", default: "false" },
      { key: "killall", label: "Kill Others", description: "Kill all running librespot instances before launch", required: false, type: "boolean", default: "false" },
      { key: "wd_timeout", label: "Watchdog Timeout", description: "Restart if no log output for this many seconds (0=disabled)", required: false, type: "number", default: "7800" },
      { key: "params", label: "Extra Params", description: "Additional CLI flags (URL-encoded, use %20 for spaces)", required: false, type: "text" },
    ],
  },
  {
    type: "airplay",
    label: "AirPlay (shairport-sync)",
    description: "Launch shairport-sync for Apple AirPlay. Requires shairport-sync binary. Fixed at 44100:16:2.",
    uriPrefix: "airplay://",
    pathPlaceholder: "/usr/bin/shairport-sync",
    fixedSampleFormat: "44100:16:2",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "Airplay" },
      { key: "devicename", label: "Device Name", description: "Advertised AirPlay receiver name", required: false, type: "text", default: "Snapcast" },
      { key: "port", label: "Port", description: "RTSP listening port (5000=AirPlay 1, 7000=AirPlay 2)", required: false, type: "select", default: "5000", options: ["5000", "7000"] },
      { key: "password", label: "Password", description: "Require this password for AirPlay connections", required: false, type: "text" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle after this many ms of silence", required: false, type: "number", default: "2000" },
      { key: "send_silence", label: "Send Silence", description: "Keep sending silence to clients when source is idle (prevents audio cuts)", required: false, type: "boolean", default: "true" },
      { key: "params", label: "Extra Params", description: "Additional CLI flags (URL-encoded)", required: false, type: "text" },
    ],
  },
  {
    type: "ffmpeg_radio",
    label: "🎵 Internet Radio (FFmpeg)",
    description: "Stream audio from any URL (Icecast, Azuracast, HLS, MP3, FLAC streams) using FFmpeg with auto-reconnect. Ideal for web radio stations.",
    uriPrefix: "process://",
    pathPlaceholder: "/usr/bin/ffmpeg",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "Radio" },
      { key: "_stream_url", label: "Stream URL", description: "Full URL to the audio stream (MP3, HLS m3u8, FLAC, etc.)", required: true, type: "text", placeholder: "https://example.com/listen/station/radio.mp3" },
      { key: "codec", label: "Codec", description: "Output codec", required: false, type: "select", default: "pcm", options: ["pcm", "flac", "ogg", "opus"] },
      { key: "sampleformat", label: "Sample Format", description: "Output sample format", required: false, type: "text", default: "48000:16:2" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle after this many ms of silence", required: false, type: "number", default: "15000" },
      { key: "send_silence", label: "Send Silence", description: "Keep sending silence when stream is inactive", required: false, type: "boolean", default: "true" },
      { key: "log_stderr", label: "Log stderr", description: "Forward FFmpeg stderr output to Snapserver log", required: false, type: "boolean", default: "false" },
      { key: "_reconnect", label: "Reconnect on error", description: "Reconnect automatically if the stream drops or returns an error", required: false, type: "boolean", default: "true" },
      { key: "_reconnect_streamed", label: "Reconnect streamed", description: "Reconnect when the server closes the connection mid-stream", required: false, type: "boolean", default: "true" },
      { key: "_reconnect_at_eof", label: "Reconnect at EOF", description: "Reconnect when the server sends a clean EOF (common on HLS and Icecast chunk rotation)", required: false, type: "boolean", default: "false" },
      { key: "_reconnect_on_network_error", label: "Reconnect on network error", description: "Reconnect on low-level network failures (TCP reset, DNS failure, etc.)", required: false, type: "boolean", default: "false" },
      { key: "_reconnect_delay_max", label: "Max reconnect delay (s)", description: "Maximum seconds to wait between reconnection attempts", required: false, type: "number", default: "5" },
    ],
  },
  {
    type: "process",
    label: "Process (Generic)",
    description: "Launch any process and read PCM audio from stdout. Use with mpv, go-librespot, custom scripts, etc.",
    uriPrefix: "process://",
    pathPlaceholder: "/usr/bin/mpv",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "Process" },
      { key: "params", label: "Arguments", description: "Process command line arguments (URL-encoded, %20 for spaces)", required: false, type: "text" },
      { key: "codec", label: "Codec", description: "Override default codec for this source", required: false, type: "select", options: ["pcm", "flac", "ogg", "opus"] },
      { key: "sampleformat", label: "Sample Format", description: "Override default sample format (rate:bits:channels)", required: false, type: "text", placeholder: "48000:16:2" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle after this many ms of no output", required: false, type: "number" },
      { key: "send_silence", label: "Send Silence", description: "Keep sending silence to clients when source is idle", required: false, type: "boolean", default: "false" },
      { key: "wd_timeout", label: "Watchdog Timeout", description: "Restart if no stderr output for this many seconds (0=disabled)", required: false, type: "number", default: "0" },
      { key: "log_stderr", label: "Log stderr", description: "Forward process stderr to Snapserver log", required: false, type: "boolean", default: "false" },
    ],
  },
  {
    type: "file",
    label: "File",
    description: "Read raw PCM audio from a file.",
    uriPrefix: "file://",
    pathPlaceholder: "/path/to/pcm/file",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "File" },
      { key: "codec", label: "Codec", description: "Override default codec", required: false, type: "select", options: ["pcm", "flac", "ogg", "opus"] },
      { key: "sampleformat", label: "Sample Format", description: "Override default sample format (rate:bits:channels)", required: false, type: "text", placeholder: "48000:16:2" },
    ],
  },
  {
    type: "tcp",
    label: "TCP (PC/Laptop)",
    description: "Receive audio from PCs or laptops over TCP. Server mode listens for connections from clients like SnapTx, FFMPEG, or custom senders.",
    uriPrefix: "tcp://",
    pathPlaceholder: "0.0.0.0:4953",
    params: [
      { key: "name", label: "Name", description: "Unique stream name (e.g., FrontDesk-PC)", required: true, type: "text", placeholder: "PC-Stream" },
      { key: "mode", label: "Mode", description: "Server (listen for connections) or Client (connect to remote)", required: false, type: "select", default: "server", options: ["server", "client"] },
      { key: "codec", label: "Codec", description: "Audio codec", required: false, type: "select", default: "pcm", options: ["pcm", "flac", "ogg", "opus"] },
      { key: "sampleformat", label: "Sample Format", description: "Audio format (rate:bits:channels)", required: false, type: "text", default: "48000:16:2" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle after this many ms of no data (prevents ghost streams)", required: false, type: "number", default: "10000" },
      { key: "send_silence", label: "Send Silence", description: "Keep sending silence when PC disconnects (prevents audio gaps)", required: false, type: "boolean", default: "true" },
      { key: "retry", label: "Retry Count", description: "Number of reconnection attempts before giving up", required: false, type: "number", default: "3" },
      { key: "timeout", label: "Timeout (s)", description: "Connection timeout in seconds", required: false, type: "number", default: "5" },
    ],
  },
  {
    type: "alsa",
    label: "ALSA",
    description: "Capture audio from an ALSA device. Use for line-in or loopback devices.",
    uriPrefix: "alsa://",
    pathPlaceholder: "/",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "ALSA" },
      { key: "device", label: "Device", description: "ALSA device name (e.g., default, hw:0,0, hw:0,1,0)", required: true, type: "text", placeholder: "hw:0,0" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle state after this many ms of silence", required: false, type: "number", default: "100" },
      { key: "silence_threshold_percent", label: "Silence Threshold %", description: "Amplitude % below which audio is considered silence", required: false, type: "text", default: "0.0" },
      { key: "send_silence", label: "Send Silence", description: "Forward silence to clients when idle", required: false, type: "boolean", default: "false" },
    ],
  },
  {
    type: "meta",
    label: "Meta (Mixer)",
    description: "Mix audio from multiple sources. Plays the active source with highest priority (first listed = highest). Great for fallback chains.",
    uriPrefix: "meta://",
    pathPlaceholder: "",
    isMeta: true,
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "Mix" },
      { key: "codec", label: "Codec", description: "Output codec for the mixed stream", required: false, type: "select", options: ["pcm", "flac", "ogg", "opus"] },
      { key: "sampleformat", label: "Sample Format", description: "Output format (rate:bits:channels)", required: false, type: "text", placeholder: "48000:16:2" },
      { key: "send_silence", label: "Send Silence", description: "Keep sending silence when no source is active", required: false, type: "boolean", default: "true" },
    ],
  },
  {
    type: "jack",
    label: "JACK",
    description: "Read from a JACK audio server. Requires Snapcast built with BUILD_WITH_JACK=ON.",
    uriPrefix: "jack://",
    pathPlaceholder: "/",
    params: [
      { key: "name", label: "Name", description: "Unique stream name", required: true, type: "text", placeholder: "JACK" },
      { key: "server_name", label: "Server Name", description: "JACK server name (empty = default)", required: false, type: "text" },
      { key: "autoconnect", label: "Auto-connect Regex", description: "Regex to match JACK ports for auto-connection", required: false, type: "text" },
      { key: "autoconnect_skip", label: "Auto-connect Skip", description: "Skip this many regex matches (for multi-channel selection)", required: false, type: "number", default: "0" },
      { key: "idle_threshold", label: "Idle Threshold (ms)", description: "Switch to idle after this many ms of silence", required: false, type: "number", default: "100" },
      { key: "silence_threshold_percent", label: "Silence Threshold %", description: "Amplitude % considered as silence", required: false, type: "text", default: "0.0" },
      { key: "send_silence", label: "Send Silence", description: "Forward silence to clients when idle", required: false, type: "boolean", default: "false" },
    ],
  },
];
