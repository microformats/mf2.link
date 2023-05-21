const express = require("express");
const ejs = require("ejs");

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3010;
var Microformats = require("microformat-node"), Cheerio = require('cheerio'), options = {};

const app = express();

app.set("view engine", "ejs");
app.use(express.static("public"));
// allow json
app.use(express.json());

const SERVICES = {
    "mastodon": "mastodon"
}


function compileVCard (last_name, first_name, additional_name, honorific_prefix, honorific_suffix, full_name, organization, title, tel, email, url) {
    var final_vcard = `
    BEGIN:VCARD
    VERSION:3.0
    `;

    if (first_name || last_name) {
        first_name = first_name || "";
        last_name = last_name || "";
        additional_name = additional_name || "";
        honorific_prefix = honorific_prefix || "";
        honorific_suffix = honorific_suffix || "";
        
        final_vcard += `
        N:${last_name};${first_name};${additional_name};${honorific_prefix};${honorific_suffix}
        `;
    }

    final_vcard += `
    FN:${full_name}
    `;

    final_vcard += `
    ORG:${organization}
    `;

    final_vcard += `
    TITLE:${title}
    `;

    if (tel) {
        final_vcard += `
        TEL;TYPE=home,voice;VALUE=uri:tel:${tel}
        `;
    }

    // add email
    final_vcard += `
    EMAIL:${email}
    `;

    // add url
    final_vcard += `
    URL:${url}
    `;

    // end vcard
    final_vcard += `
    END:VCARD
    `;

    // strip whitespace
    final_vcard = final_vcard.replace(/^\s+|\s+$/g, '');

    return final_vcard;
}

function get(object, key, default_value) {
    var result = object[key];
    return (typeof result !== "undefined") ? result : default_value;
}

app.route("/").get(async (req, res) => {
    res.render("home");
});

app.route("/").post(async (req, res) => {
    // get fromjson body
    var url = req.body.url;
    var service = req.body.service;

    if (!url) {
        // load home.ejs
        res.render("home");
        return;
    }

    if (!service || !SERVICES[service]) {
        res.render("home", {
            error: "Invalid service"
        });
        return;
    }

    res.redirect("/" + SERVICES[service] + "?url=" + url);
    return;
});


app.route("/mastodon").get(async (req, res) => {
    var url = req.query.url;

    if (!url) {
        // load home.ejs
        res.render("home");
        return;
    }

    try {
        var parsed_url = new URL(url);
    } catch (e) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    var domain = parsed_url.hostname;

    var status_id = parsed_url.pathname.split("/");
    
    status_id = status_id[status_id.length - 1];

    var query_url = "https://" + domain + "/api/v1/statuses/" + status_id;

    fetch(query_url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json"
        }
    }).then((response) => {
        // if not json, error
        if (!response.ok) {
            res.render("error", {
                error: "There was an error retrieving this post."
            });
            return;
        }
        response.json().then((data) => {
            // if not json, error
            if (!data) {
                res.render("error", {
                    error: "There was an error retrieving this post."
                });
                return;
            }
            var is_reply = data.in_reply_to_id != null;

            var date = new Date(data.created_at);

            data.created_at = date.toLocaleString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "numeric",
                second: "numeric",
                hour12: true,
            }).replace(",", "");
    
            if (is_reply) {
                var reply_url = "https://" + domain + "/api/v1/statuses/" + data.in_reply_to_id;
    
                fetch(reply_url, {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json"
                    }
                }).then((response) => {
                    response.json().then((reply_data) => {
                        res.render("mastodon", {
                            data: data,
                            reply: reply_data
                        });
                    });
                }).catch((err) => {
                    res.render("error", {
                        error: "There was an error retrieving this post."
                    });
                    return;
                });
            } else {
                res.render("mastodon", {
                    data: data,
                    reply: null
                });
            } 
        }).catch((err) => {
            res.render("error", {
                error: "There was an error retrieving this post."
            });
            return;
        });
    }).catch((err) => {
        res.render("error", {
            error: "There was an error retrieving this post."
        });
        return;
    });
});

app.route("/hcard").get(async (req, res) => {
    var url = req.query.url;

    if (!url) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    try {
        var parsed_url = new URL(url);
    } catch (e) {
        res.render("error", {
            error: "Invalid URL"
        });
        return;
    }

    fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "text/html"
        }
    }).then((response) => {
        response.text().then((data) => {
            console.log(data);
            options.html = data;

            Microformats.get(options, function (err, data) {
                // con
                console.log(data, err)
                if (err) {
                    res.render("error", {
                        error: "There was an error parsing this page."
                    });
                    return;
                }

                var hcard = null;

                // find hcard
                for (var i = 0; i < data.items.length; i++) {
                    // console.log(data.items[i]);
                    if (data.items[i].type.includes("h-card")) {
                        hcard = data.items[i].properties;
                        break;
                    }
                }

                if (!hcard) {
                    // console.log(hcard);
                    res.render("error", {
                        error: "No h-card was found."
                    });
                    return;
                }

                console.log(hcard)

                // if org, expand out
                if (hcard.org) {
                    var org_titles = [];
                    var orgs = [];

                    for (var i = 0; i < hcard.org.length; i++) {
                        var org = hcard.org[i].value;
                        var title = hcard.org[i].properties.name;

                        orgs.push(org);
                        org_titles.push(title);
                    }

                    // join orgs as string
                    hcard.title = org_titles.join(",").replace(/,/g, ", ");
                    hcard.org = orgs.join(",").replace(/,/g, ", ");
                }

                var vcard = compileVCard(
                    get(hcard, "family-name", [null])[0],
                    get(hcard, "given-name", [null])[0],
                    get(hcard, "additional-name", [null])[0],
                    get(hcard, "honorific-prefix", [null])[0],
                    get(hcard, "honorific-suffix", [null])[0],
                    get(hcard, "name", [null])[0],
                    get(hcard, "org", [null]),
                    get(hcard, "title", [null]),
                    get(hcard, "tel", [null])[0],
                    get(hcard, "email", [null])[0],
                    url
                )

                res.set("Content-Type", "text/plain");
                res.send(vcard);
            });
        });
    }).catch((err) => {
        res.render("error", {
            error: "There was an error retrieving this page."
        });
        return;
    });
});

app.listen(PORT, () => {
    console.log(`Server started on port ${PORT}`);
});
