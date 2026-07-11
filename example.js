export default function handler(req, res) {
    if(req.method === "GET") {
        if(req.query.code) {
            req.session.refresh = false
            req.session.authCode = req.query.code
            res.redirect("/")
        }
    }
}