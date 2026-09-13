// Static public files stay at their public URL in a single-locale host proxy.
export const NGINX_STATIC_ASSETS = `    location ~* "\\.[a-z0-9]{1,16}$" {
        proxy_pass http://web:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

`

export const CADDY_STATIC_ASSETS = `\t@staticAsset path_regexp staticAsset ^/.*\\.[a-zA-Z0-9]{1,16}$
\thandle @staticAsset {
\t\treverse_proxy web:3000 {
\t\t\theader_up Host {host}
\t\t}
\t}

`
