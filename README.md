# Family Christmas Lists

A small website for sharing Christmas lists with family. Anyone with the link can see every list and mark gifts as bought. Only someone with the owner key can add, edit or delete lists and gifts.

## What's in this folder

- `public/index.html` is the website.
- `netlify/functions/api.mjs` is the small server piece. It saves the lists, stores photos, and looks up a product's photo and name from a store link.
- `netlify.toml` and `package.json` tell Netlify how to build the site.

## Put it online (about 20 minutes, free)

1. **Make a GitHub account** at github.com, if you don't have one.
2. **Create a repository.** Click **New repository**, name it `christmas-lists`, choose **Private**, and click **Create repository**.
3. **Upload the files.** On the new repository page, click **uploading an existing file**. Drag in everything inside this folder (the `public` and `netlify` folders, `netlify.toml`, `package.json` and this README). Click **Commit changes**.
4. **Make a Netlify account** at netlify.com. Signing up with your GitHub account is easiest.
5. **Import the site.** In Netlify, choose **Add new project → Import an existing project → GitHub**, pick `christmas-lists`, leave the build settings as they are, and click **Deploy**.
6. **Set your owner key.** In the Netlify project, go to **Project configuration → Environment variables → Add a variable**. Set the key to `EDIT_KEY` and the value to a password only you know, like `snowman-candle-4182`.
7. **Redeploy.** Go to **Deploys → Trigger deploy → Deploy project** so the key takes effect.
8. **Open your owner link** on each device you'll edit from: `https://YOUR-SITE.netlify.app/?key=YOUR-EDIT-KEY`. The site remembers the key on that device and removes it from the address bar.
9. **Share the family link**, `https://YOUR-SITE.netlify.app`, with the grandparents. Never share the link that has `?key=` in it.

Optional: in **Project configuration → General → Change project name**, rename the site so the address is friendlier, like `harper-christmas.netlify.app`.

## Using it

- On the home page, pick how many family members to shop for and press **Create**. Click a name to rename it.
- Open a person's list and paste a store link. The photo and item name usually fill in automatically. Type the price and click **Add to list**.
- If a store doesn't share its photo, copy the product photo on the store's page (right-click → Copy image) and paste it onto the page.
- **Find missing photos** retries the photo lookup for every gift that doesn't have one yet.
- Family members tap **I bought this** and can add their name, so nobody buys the same gift twice.

## Good to know

- Photo lookups use the store page first, then a free backup service that allows about 50 lookups a day.
- Amazon photos are found from the product number in the link, so full Amazon links (with `/dp/` in them) work best.
- Anyone with the family link can mark gifts as bought or not bought, but can't change anything else.
