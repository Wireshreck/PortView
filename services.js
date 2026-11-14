'use strict';

/**
 * Sections shown in the viewer, in display order.
 *
 * 'apps' is reserved for ports you have named yourself and for local
 * projects that PortView worked out on its own.
 */
const SECTION_ORDER = [
  'apps',
  'web',
  'dev',
  'database',
  'messaging',
  'remote',
  'media',
  'proxy',
  'system',
  'other',
];

const SECTION_LABELS = {
  apps: 'Your Apps',
  web: 'Web & Browsable',
  dev: 'Dev Servers & Tooling',
  database: 'Databases',
  messaging: 'Messaging & Queues',
  remote: 'Remote Access',
  media: 'Media Servers',
  proxy: 'Proxies & Gateways',
  system: 'System & Core',
  other: 'Other Open Ports',
};

const SECTION_DESCRIPTIONS = {
  apps: 'Ports you have named, and local projects that were detected',
  web: 'HTTP endpoints you can open in a browser',
  dev: 'Development servers, hot reloaders and debuggers',
  database: 'Database servers',
  messaging: 'Message queues, brokers and event buses',
  remote: 'Shell, desktop and file sharing',
  media: 'Music, video and photo libraries',
  proxy: 'Forwarders, caches and tunnels',
  system: 'Operating system services',
  other: 'Everything else that is listening',
};

/**
 * Known ports: service name, friendly label and section.
 *
 * `web: true` means the port is expected to speak HTTP and can be opened
 * in a browser. `scheme` overrides the default http:// prefix.
 */
const PORT_CATALOG = {
  // --- web servers and http --------------------------------------------
  80: { service: 'http', label: 'Web Server', section: 'web', web: true },
  81: { service: 'http', label: 'Web Server', section: 'web', web: true },
  88: { service: 'kerberos', label: 'Kerberos HTTP', section: 'web', web: true },
  443: { service: 'https', label: 'Secure Web Server', section: 'web', web: true, scheme: 'https' },
  591: { service: 'http', label: 'Web Interface', section: 'web', web: true },
  631: { service: 'ipp', label: 'Printer Web Interface', section: 'web', web: true },
  800: { service: 'http', label: 'Web Server', section: 'web', web: true },
  808: { service: 'http', label: 'Web Server', section: 'web', web: true },
  880: { service: 'http', label: 'Web Console', section: 'web', web: true },
  1080: { service: 'socks', label: 'SOCKS Proxy', section: 'proxy' },
  1443: { service: 'https', label: 'Secure Web Server', section: 'web', web: true, scheme: 'https' },
  2080: { service: 'http', label: 'Web App', section: 'web', web: true },
  2082: { service: 'http', label: 'Web App', section: 'web', web: true },
  2083: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  2086: { service: 'http', label: 'Web App', section: 'web', web: true },
  2087: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  2095: { service: 'http', label: 'Web App', section: 'web', web: true },
  2096: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  2480: { service: 'http', label: 'Web App', section: 'web', web: true },
  3000: { service: 'http', label: 'Web App', section: 'web', web: true },
  3001: { service: 'http', label: 'Web App', section: 'web', web: true },
  3128: { service: 'squid', label: 'Squid Proxy', section: 'proxy' },
  3300: { service: 'http', label: 'Web App', section: 'web', web: true },
  4443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  5000: { service: 'http', label: 'Web App', section: 'web', web: true },
  5001: { service: 'http', label: 'Web App', section: 'web', web: true },
  5800: { service: 'http', label: 'Web Admin', section: 'web', web: true },
  6443: { service: 'https', label: 'Kubernetes API', section: 'web', web: true, scheme: 'https' },
  7001: { service: 'weblogic', label: 'WebLogic Server', section: 'web', web: true },
  7002: { service: 'weblogic', label: 'WebLogic Admin', section: 'web', web: true },
  7080: { service: 'http', label: 'Web App', section: 'web', web: true },
  7443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  7777: { service: 'http', label: 'Web App', section: 'web', web: true },
  8000: { service: 'http', label: 'Web App', section: 'web', web: true },
  8001: { service: 'http', label: 'Web App', section: 'web', web: true },
  8002: { service: 'http', label: 'Web App', section: 'web', web: true },
  8003: { service: 'http', label: 'Web App', section: 'web', web: true },
  8008: { service: 'http', label: 'Web App', section: 'web', web: true },
  8010: { service: 'http', label: 'Web App', section: 'web', web: true },
  8042: { service: 'http', label: 'Web App', section: 'web', web: true },
  8060: { service: 'http', label: 'Web App', section: 'web', web: true },
  8069: { service: 'http', label: 'Web App', section: 'web', web: true },
  8080: { service: 'http', label: 'Web App / Proxy', section: 'web', web: true },
  8081: { service: 'http', label: 'Web App', section: 'web', web: true },
  8082: { service: 'http', label: 'Web App', section: 'web', web: true },
  8083: { service: 'http', label: 'Web App', section: 'web', web: true },
  8084: { service: 'http', label: 'Web App', section: 'web', web: true },
  8085: { service: 'http', label: 'Web App', section: 'web', web: true },
  8086: { service: 'http', label: 'Web App', section: 'web', web: true },
  8087: { service: 'http', label: 'Web App', section: 'web', web: true },
  8088: { service: 'http', label: 'Web App', section: 'web', web: true },
  8089: { service: 'http', label: 'Web App', section: 'web', web: true },
  8090: { service: 'http', label: 'Web App', section: 'web', web: true },
  8091: { service: 'http', label: 'Web App', section: 'web', web: true },
  8161: { service: 'http', label: 'Web App', section: 'web', web: true },
  8180: { service: 'http', label: 'Web App', section: 'web', web: true },
  8181: { service: 'http', label: 'Web App', section: 'web', web: true },
  8443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  8500: { service: 'http', label: 'Consul Web UI', section: 'web', web: true },
  8834: { service: 'http', label: 'Web App', section: 'web', web: true },
  8880: { service: 'http', label: 'Web App', section: 'web', web: true },
  8888: { service: 'http', label: 'Web App', section: 'web', web: true },
  8983: { service: 'http', label: 'Web App', section: 'web', web: true },
  9000: { service: 'http', label: 'Web App / PHP-FPM', section: 'web', web: true },
  9001: { service: 'http', label: 'Nuxt / Web App', section: 'web', web: true },
  9043: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  9060: { service: 'http', label: 'Web Admin', section: 'web', web: true },
  9080: { service: 'http', label: 'Web App', section: 'web', web: true },
  9090: { service: 'http', label: 'Prometheus', section: 'web', web: true },
  9091: { service: 'http', label: 'Web App', section: 'web', web: true },
  9100: { service: 'http', label: 'Web App', section: 'web', web: true },
  9443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  9800: { service: 'http', label: 'Web App', section: 'web', web: true },
  9981: { service: 'http', label: 'Web App', section: 'web', web: true },
  10000: { service: 'webmin', label: 'Webmin', section: 'web', web: true },
  10443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  12443: { service: 'https', label: 'Secure Web App', section: 'web', web: true, scheme: 'https' },
  15672: { service: 'http', label: 'RabbitMQ Management', section: 'web', web: true },
  16080: { service: 'http', label: 'Web App', section: 'web', web: true },
  18080: { service: 'http', label: 'Web App', section: 'web', web: true },
  28017: { service: 'mongodb', label: 'MongoDB Web Shell', section: 'web', web: true },
  30000: { service: 'http', label: 'Kubernetes NodePort', section: 'web', web: true },
  32400: { service: 'http', label: 'Plex Media Server', section: 'media', web: true },

  // --- dev servers and tooling -----------------------------------------
  1234: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  1337: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  4040: { service: 'http', label: 'Spring Boot App', section: 'dev', web: true },
  24678: { service: 'http', label: 'Vite HMR', section: 'dev', web: true },
  3030: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  35729: { service: 'http', label: 'Vite HMR Socket', section: 'dev' },
  4000: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  4173: { service: 'http', label: 'Vite Preview Server', section: 'dev', web: true },
  4200: { service: 'http', label: 'Angular Dev Server', section: 'dev', web: true },
  4242: { service: 'http', label: 'Storybook', section: 'dev', web: true },
  4243: { service: 'http', label: 'Docker Swarm', section: 'dev', web: true },
  4444: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  4445: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  4848: { service: 'http', label: 'GlassFish Server', section: 'dev', web: true },
  5173: { service: 'http', label: 'Vite Dev Server', section: 'dev', web: true },
  5300: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  6006: { service: 'http', label: 'Storybook', section: 'dev', web: true },
  6100: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  6543: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  7007: { service: 'http', label: 'Webpack Dev Server', section: 'dev', web: true },
  7800: { service: 'http', label: 'Dev Server', section: 'dev', web: true },
  9222: { service: 'http', label: 'Chrome DevTools', section: 'dev', web: true },
  9229: { service: 'http', label: 'Chrome DevTools', section: 'dev', web: true },
  19000: { service: 'http', label: 'Storybook', section: 'dev', web: true },

  // --- databases ---------------------------------------------------------
  1433: { service: 'mssql', label: 'Microsoft SQL Server', section: 'database' },
  1521: { service: 'oracle', label: 'Oracle Database', section: 'database' },
  2222: { service: 'neo4j', label: 'Neo4j Bolt', section: 'database' },
  2375: { service: 'docker', label: 'Docker Engine API', section: 'dev' },
  2376: { service: 'docker', label: 'Docker Engine API (TLS)', section: 'dev' },
  3306: { service: 'mysql', label: 'MySQL', section: 'database' },
  5432: { service: 'postgres', label: 'PostgreSQL', section: 'database' },
  5601: { service: 'http', label: 'Kibana', section: 'database', web: true },
  5984: { service: 'couchdb', label: 'CouchDB', section: 'database' },
  6379: { service: 'redis', label: 'Redis', section: 'database' },
  7000: { service: 'cassandra', label: 'Cassandra (Inter-node)', section: 'database' },
  7474: { service: 'http', label: 'Neo4j Browser', section: 'database', web: true },
  7687: { service: 'neo4j', label: 'Neo4j Bolt', section: 'database' },
  9042: { service: 'cassandra', label: 'Cassandra', section: 'database' },
  9093: { service: 'influxdb', label: 'InfluxDB', section: 'database' },
  9200: { service: 'elasticsearch', label: 'Elasticsearch', section: 'database' },
  9300: { service: 'elasticsearch', label: 'Elasticsearch Transport', section: 'database' },
  9418: { service: 'git', label: 'Git Protocol', section: 'dev' },
  10250: { service: 'http', label: 'Kubelet API', section: 'system', web: true },
  10255: { service: 'http', label: 'Kubelet Read-only', section: 'system', web: true },
  11211: { service: 'memcached', label: 'Memcached', section: 'database' },
  27017: { service: 'mongodb', label: 'MongoDB', section: 'database' },
  27018: { service: 'mongodb', label: 'MongoDB (shard)', section: 'database' },
  27019: { service: 'mongodb', label: 'MongoDB (config)', section: 'database' },
  50000: { service: 'db2', label: 'IBM Db2', section: 'database' },
  50001: { service: 'db2', label: 'IBM Db2 (alternate)', section: 'database' },

  // --- messaging ---------------------------------------------------------
  1883: { service: 'mqtt', label: 'MQTT Broker', section: 'messaging' },
  2181: { service: 'zookeeper', label: 'ZooKeeper', section: 'messaging' },
  4222: { service: 'nats', label: 'NATS Client', section: 'messaging' },
  4369: { service: 'epmd', label: 'Erlang Port Mapper', section: 'messaging' },
  5671: { service: 'amqp', label: 'RabbitMQ (AMQPS)', section: 'messaging' },
  5672: { service: 'amqp', label: 'RabbitMQ (AMQP)', section: 'messaging' },
  6222: { service: 'nats', label: 'NATS', section: 'messaging' },
  8222: { service: 'http', label: 'NATS Monitoring', section: 'messaging', web: true },
  9092: { service: 'kafka', label: 'Apache Kafka', section: 'messaging' },
  15692: { service: 'http', label: 'Kafka Monitoring', section: 'messaging', web: true },
  61613: { service: 'stomp', label: 'ActiveMQ STOMP', section: 'messaging' },
  61614: { service: 'openwire', label: 'ActiveMQ OpenWire', section: 'messaging' },
  61616: { service: 'activemq', label: 'Apache ActiveMQ', section: 'messaging' },

  // --- remote access -----------------------------------------------------
  21: { service: 'ftp', label: 'File Transfer (FTP)', section: 'remote' },
  22: { service: 'ssh', label: 'Secure Shell', section: 'remote' },
  23: { service: 'telnet', label: 'Telnet', section: 'remote' },
  69: { service: 'tftp', label: 'Trivial File Transfer', section: 'remote' },
  111: { service: 'rpcbind', label: 'RPC Port Mapper', section: 'remote' },
  445: { service: 'smb', label: 'File Sharing (SMB)', section: 'remote' },
  873: { service: 'rsync', label: 'rsync', section: 'remote' },
  1723: { service: 'pptp', label: 'VPN (PPTP)', section: 'remote' },
  2049: { service: 'nfs', label: 'Network File System', section: 'remote' },
  3389: { service: 'rdp', label: 'Remote Desktop', section: 'remote' },
  5900: { service: 'vnc', label: 'VNC Remote Desktop', section: 'remote' },
  5901: { service: 'vnc', label: 'VNC (X11)', section: 'remote' },
  5985: { service: 'winrm', label: 'Windows Remote Management', section: 'remote' },
  5986: { service: 'winrm', label: 'Windows Remote Management (TLS)', section: 'remote' },

  // --- media -------------------------------------------------------------
  1900: { service: 'upnp', label: 'UPnP Discovery', section: 'media' },
  8096: { service: 'http', label: 'Jellyfin', section: 'media', web: true },
  8200: { service: 'http', label: 'Synology DSM', section: 'media', web: true },
  8920: { service: 'http', label: 'Plex Transcoder', section: 'media', web: true },

  // --- proxies and gateways ---------------------------------------------
  3128: { service: 'squid', label: 'Squid Proxy', section: 'proxy' },
  8118: { service: 'http', label: 'Proxy Server', section: 'proxy' },
  9050: { service: 'tor', label: 'Tor Proxy', section: 'proxy' },
  10809: { service: 'socks', label: 'SOCKS Proxy', section: 'proxy' },

  // --- system ------------------------------------------------------------
  53: { service: 'dns', label: 'DNS Resolver', section: 'system' },
  67: { service: 'dhcp', label: 'DHCP Server', section: 'system' },
  68: { service: 'dhcp', label: 'DHCP Client', section: 'system' },
  123: { service: 'ntp', label: 'Time Sync (NTP)', section: 'system' },
  135: { service: 'msrpc', label: 'RPC Endpoint Mapper', section: 'system' },
  137: { service: 'netbios-ns', label: 'NetBIOS Name Service', section: 'system' },
  138: { service: 'netbios-dgm', label: 'NetBIOS Datagram', section: 'system' },
  139: { service: 'netbios-ssn', label: 'NetBIOS Session', section: 'system' },
  161: { service: 'snmp', label: 'SNMP', section: 'system' },
  389: { service: 'ldap', label: 'Directory Service', section: 'system' },
  500: { service: 'isakmp', label: 'IPsec Negotiator', section: 'system' },
  514: { service: 'syslog', label: 'System Log', section: 'system' },
  636: { service: 'ldaps', label: 'Directory Service (TLS)', section: 'system' },
  1194: { service: 'openvpn', label: 'VPN (OpenVPN)', section: 'system' },
  1701: { service: 'l2tp', label: 'VPN (L2TP)', section: 'system' },
  1812: { service: 'radius', label: 'RADIUS Authentication', section: 'system' },
  1813: { service: 'radius', label: 'RADIUS Accounting', section: 'system' },
  2010: { service: 'search', label: 'Windows Search', section: 'system' },
  3268: { service: 'gc', label: 'Global Catalog', section: 'system' },
  3269: { service: 'gc', label: 'Global Catalog (TLS)', section: 'system' },
  5353: { service: 'mdns', label: 'Multicast DNS', section: 'system' },
  5357: { service: 'wsd', label: 'Web Services Discovery', section: 'system' },
};

/**
 * Friendly names for processes that show up on developer machines.
 */
const PROCESS_LABELS = {
  'node.exe': 'Node.js Server',
  'node': 'Node.js Server',
  'python.exe': 'Python Server',
  'pythonw.exe': 'Python Server',
  'python': 'Python Server',
  'java.exe': 'Java Server',
  'javaw.exe': 'Java Server',
  'dotnet.exe': '.NET Server',
  'dotnet': '.NET Server',
  'php.exe': 'PHP Server',
  'php-cgi.exe': 'PHP Server',
  'ruby.exe': 'Ruby Server',
  'deno.exe': 'Deno Server',
  'bun.exe': 'Bun Server',
  'go.exe': 'Go Server',
  'nginx.exe': 'nginx',
  'nginx': 'nginx',
  'httpd.exe': 'Apache HTTP Server',
  'postgres.exe': 'PostgreSQL',
  'mysqld.exe': 'MySQL',
  'redis-server.exe': 'Redis',
  'mongod.exe': 'MongoDB',
  'docker.exe': 'Docker',
  'com.docker.backend.exe': 'Docker Desktop',
  'dockerd.exe': 'Docker Engine',
  'Code.exe': 'VS Code',
  'code.exe': 'VS Code',
  'chrome.exe': 'Google Chrome',
  'msedge.exe': 'Microsoft Edge',
  'firefox.exe': 'Firefox',
  'brave.exe': 'Brave',
  'opencode.exe': 'OpenCode',
  'opencode-cli.exe': 'OpenCode CLI',
  'OneDrive.Sync.Service.exe': 'OneDrive',
  'svchost.exe': 'Windows Service',
  'System': 'Windows System',
  'lsass.exe': 'Windows Credential Provider',
  'services.exe': 'Windows Service Host',
  'wininit.exe': 'Windows Init',
  'spoolsv.exe': 'Print Spooler',
  'explorer.exe': 'Windows Explorer',
  'SearchIndexer.exe': 'Windows Search Indexer',
  'SearchHost.exe': 'Windows Search',
  'w3wp.exe': 'IIS Worker Process',
  'sqlservr.exe': 'SQL Server',
  'taskhostw.exe': 'Windows Task Host',
};

/**
 * Frameworks and servers recognised from an HTTP response header.
 */
const FRAMEWORK_LABELS = {
  vite: 'Vite Dev Server',
  'vite preview': 'Vite Preview Server',
  'next.js': 'Next.js App',
  'nextjs': 'Next.js App',
  nuxt: 'Nuxt App',
  express: 'Express App',
  'express.js': 'Express App',
  fastify: 'Fastify App',
  koa: 'Koa App',
  nestjs: 'NestJS App',
  'nest.js': 'NestJS App',
  django: 'Django App',
  flask: 'Flask App',
  'python': 'Python Web Server',
  'simplehttp': 'Python Web Server',
  'apache': 'Apache Web Server',
  nginx: 'nginx Web Server',
  'iis': 'IIS Web Server',
  'microsoft-iis': 'IIS Web Server',
  'node.js': 'Node.js Web Server',
  'websocket': 'WebSocket Server',
  gitea: 'Gitea',
  gogs: 'Gogs',
  jenkins: 'Jenkins',
  grafana: 'Grafana',
  prometheus: 'Prometheus',
  'jupyter notebook': 'Jupyter Notebook',
  jupyter: 'Jupyter Notebook',
  'code-server': 'code-server',
  'http.server': 'Python Web Server',
  'basehttp': 'Python Web Server',
};

/**
 * Ports that are commonly occupied by a local development tool even though
 * the generic service name says nothing useful.
 */
const PORT_HINTS = {
  3000: 'React / Next.js dev server',
  3001: 'Node dev server',
  4000: 'Node dev server',
  4173: 'Vite preview server',
  5000: 'Flask / Node dev server',
  5173: 'Vite dev server',
  8080: 'Node / proxy',
};

/**
 * Ports that are interesting enough to probe when doing a quick sweep.
 */
const COMMON_PORTS = [
  21, 22, 23, 25, 53, 67, 68, 69, 80, 88, 102, 110, 111, 119, 123, 135, 137, 138, 139,
  143, 161, 179, 389, 443, 445, 464, 465, 512, 513, 514, 515, 520, 548, 554, 587, 623,
  631, 636, 873, 993, 995, 1080, 1099, 1433, 1434, 1521, 1723, 1883, 1900, 2049, 2181,
  2375, 2376, 2379, 3000, 3128, 3268, 3306, 3389, 3690, 4000, 4173, 4200, 4369, 4444,
  4848, 5000, 5001, 5037, 5060, 5222, 5353, 5432, 5555, 5672, 5683, 5900, 5984, 6000,
  6379, 6443, 6660, 6667, 7001, 7002, 7070, 7077, 7443, 7777, 8000, 8008, 8009, 8080,
  8081, 8088, 8091, 8161, 8443, 8500, 8761, 8888, 8983, 9000, 9042, 9090, 9200, 9229,
  9300, 9418, 9999, 10000, 10250, 11211, 11235, 15672, 27017, 27018, 28017, 33060,
];

function catalogFor(port) {
  return PORT_CATALOG[port] || null;
}

function serviceFor(port) {
  const entry = PORT_CATALOG[port];
  return entry ? entry.service : null;
}

function labelFor(port) {
  const entry = PORT_CATALOG[port];
  return entry ? entry.label : null;
}

function sectionFor(port) {
  const entry = PORT_CATALOG[port];
  return entry ? entry.section : 'other';
}

function isWebPort(port) {
  const entry = PORT_CATALOG[port];
  return !!(entry && entry.web);
}

function schemeFor(port) {
  const entry = PORT_CATALOG[port];
  return entry && entry.scheme ? entry.scheme : 'http';
}

/**
 * Friendly label for a process image name.
 */
function processLabel(imageName) {
  if (!imageName) return null;
  const known = PROCESS_LABELS[imageName] || PROCESS_LABELS[imageName.toLowerCase()];
  if (known) return known;

  // Fall back to a readable form of the image name: "my_service.exe" ->
  // "My Service".
  const base = imageName.replace(/\.(exe|bin|com)$/i, '');
  if (!base || base === imageName) return null;
  return prettify(base);
}

/**
 * Turn a package or module name into something readable.
 * "hermes_cli" -> "Hermes Cli", "rea-agents" -> "Rea Agents"
 */
function prettify(name) {
  return String(name)
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Friendly label for an HTTP server header, e.g. "Vite" -> "Vite Dev Server".
 */
function frameworkLabel(header) {
  if (!header) return null;
  const cleaned = String(header).split('/')[0].trim().toLowerCase();
  if (!cleaned) return null;

  for (const [needle, label] of Object.entries(FRAMEWORK_LABELS)) {
    if (cleaned.includes(needle)) return label;
  }
  return null;
}

module.exports = {
  SECTION_ORDER,
  SECTION_LABELS,
  SECTION_DESCRIPTIONS,
  PORT_CATALOG,
  PROCESS_LABELS,
  FRAMEWORK_LABELS,
  PORT_HINTS,
  COMMON_PORTS,
  catalogFor,
  serviceFor,
  labelFor,
  sectionFor,
  isWebPort,
  schemeFor,
  processLabel,
  frameworkLabel,
  prettify,
};
