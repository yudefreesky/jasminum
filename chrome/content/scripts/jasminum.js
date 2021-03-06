Zotero.Jasminum = {
    init: async function () {
        // Register the callback in Zotero as an item observer
        var notifierID = Zotero.Notifier.registerObserver(
            Zotero.Jasminum.notifierCallback,
            ["item"]
        );
        // Unregister callback when the window closes (important to avoid a memory leak)
        window.addEventListener(
            "unload",
            function (e) {
                Zotero.Notifier.unregisterObserver(notifierID);
            },
            false
        );
        // 等待数据维护更新完毕
        // await Zotero.Schema.schemaUpdatePromise;
        Zotero.Jasminum.initPref();
        Components.utils.import("resource://gre/modules/osfile.jsm");
        Zotero.debug("Init Jasminum ...");
    },

    initPref: function () {
        if (Zotero.Prefs.get("jasminum.pdftkpath") === undefined) {
            var pdftkpath = "C:\\Program Files (x86)\\PDFtk Server\\bin";
            if (Zotero.isMac || Zotero.isLinux) {
                pdftkpath = "/usr/bin";
            }
            Zotero.Prefs.set("jasminum.pdftkpath", pdftkpath);
        }
        if (Zotero.Prefs.get("jasminum.autoupdate") === undefined) {
            Zotero.Prefs.set("jasminum.autoupdate", false);
        }
        if (Zotero.Prefs.get("jasminum.namepatent") === undefined) {
            Zotero.Prefs.set("jasminum.namepatent", "{%t}_{%g}");
        }
    },

    notifierCallback: {
        // Check new added item, and adds meta data.
        notify: function (event, type, ids, extraData) {
            // var automatic_pdf_download_bool = Zotero.Prefs.get('zoteroscihub.automatic_pdf_download');
            if (event == "add" && Zotero.Prefs.get("jasminum.autoupdate")) {
                Zotero.debug("** Jasminum new items added.");
                var items = [];
                for (let item of Zotero.Items.get(ids)) {
                    if (Zotero.Jasminum.checkItem(item)) {
                        items.push(item);
                    }
                }
                Zotero.debug(`** Jasminum add ${items.length} items`);
                Zotero.Jasminum.updateItems(items);
            }
        },
    },

    displayMenuitem: function () {
        var pane = Services.wm.getMostRecentWindow("navigator:browser")
            .ZoteroPane;
        var items = pane.getSelectedItems();
        Zotero.debug("**Jasminum selected item length: " + items.length);
        var showMenu = items.some((item) => Zotero.Jasminum.checkItem(item));
        pane.document.getElementById(
            "zotero-itemmenu-jasminum"
        ).hidden = !showMenu;
        var showMenuName = items.some((item) =>
            Zotero.Jasminum.checkItemName(item)
        );
        pane.document.getElementById(
            "zotero-itemmenu-jasminum-namehandler"
        ).hidden = !showMenuName;
        var showMenuPDF = false;
        if (items.length === 1) {
            showMenuPDF = Zotero.Jasminum.checkItemPDF(items[0]);
            Zotero.debug("** Jasminum show menu PDF: " + showMenuPDF);
            pane.document.getElementById(
                "zotero-itemmenu-jasminum-bookmark"
            ).hidden = !showMenuPDF;
        }
        pane.document.getElementById("id-jasminum-separator").hidden = !(
            showMenu ||
            showMenuPDF ||
            showMenuName
        );
        Zotero.debug(
            "**Jasminum show menu: " + showMenu + showMenuName + showMenuPDF
        );
        Zotero.debug("**Jasminum show menu: " + (showMenu || showMenuPDF));
    },

    updateSelectedEntity: function (libraryId) {
        Zotero.debug("**Jasminum Updating items in entity");
        if (!ZoteroPane.canEdit()) {
            ZoteroPane.displayCannotEditLibraryMessage();
            return;
        }

        var collection = ZoteroPane.getSelectedCollection(false);

        if (collection) {
            Zotero.debug(
                "**Jasminum Updating items in entity: Is a collection == true"
            );
            var items = [];
            collection.getChildItems(false, false).forEach(function (item) {
                items.push(item);
            });
            suppress_warnings = true;
            Zotero.Jasminum.updateItems(items, suppress_warnings);
        }
    },

    updateSelectedItems: function () {
        Zotero.debug("**Jasminum Updating Selected items");
        Zotero.Jasminum.updateItems(ZoteroPane.getSelectedItems());
    },

    checkItem: function (item) {
        // Return true, when item is OK for update cnki data.
        if (
            !item.isAttachment() ||
            item.isRegularItem() ||
            !item.isTopLevelItem()
        ) {
            return false;
        }

        var filename = item.getFilename();
        // Find Chinese characters in string
        if (escape(filename).indexOf("%u") < 0) return false;
        // Extension should be CAJ or PDF
        var ext = filename.substr(filename.length - 3, 3);
        if (ext != "pdf" && ext != "caj") return false;
        return true;
    },

    splitFilename: function (filename) {
        // Make query parameters from filename
        var patent = Zotero.Prefs.get("jasminum.namepatent");
        var patentArr = patent.split("_");
        var prefix = filename.substr(0, filename.length - 4);
        var prefix = prefix.replace("_省略_", ""); // Long title contains _省略_
        var author = "";
        var title = "";
        // Remove year string
        if (patent.includes("{%y}")) {
            patentArr.splice(patentArr.indexOf("{%y}"), 1);
            prefix = prefix.replace(/[0-9]{4}[\._]/g, "");
        }
        var prefixArr = prefix.replace(/^_|_$/g, "").split("_");
        console.log(patentArr);
        console.log(prefixArr);
        if (patentArr.includes("{%g}")) {
            var authorIdx = patentArr.indexOf("{%g}");
            var authorIdx = authorIdx === 0 ? 0 : prefixArr.length - 1;
            console.log(authorIdx);
            author = prefixArr[authorIdx];
            prefixArr.splice(authorIdx, 1);
            title = prefixArr.join(" ");
        } else {
            title = prefixArr.join(" ");
        }

        return {
            author: author.replace(",", ""),
            keyword: title,
        };
    },

    createPost: async function (fileData) {
        var searchUrl =
            "https://kns.cnki.net/kns/brief/result.aspx?dbprefix=SCDB&crossDbcodes=CJFQ,CDFD,CMFD,CPFD,IPFD,CCND,CCJD";
        var respText = await Zotero.Jasminum.promiseGet(searchUrl);
        var dbCatalog = "";
        if (respText.includes("中国学术期刊网络出版总库")) {
            dbCatalog = "中国学术期刊网络出版总库";
        } else {
            dbCatalog = "中国学术文献网络出版总库";
        }
        Zotero.debug("** Jasminum search dbCatalog: " + dbCatalog);
        // Create a search string.
        static_post_data = {
            action: "",
            NaviCode: "*",
            ua: "1.21",
            isinEn: "1",
            PageName: "ASP.brief_result_aspx",
            DbPrefix: "SCDB",
            DbCatalog: dbCatalog,
            ConfigFile: "SCDB.xml",
            db_opt: "CJFQ,CDFD,CMFD,CPFD,IPFD,CCND,CCJD",
            year_type: "echar",
            CKB_extension: "ZYW",
            txt_1_sel: "SU$%=|",
            txt_1_value1: fileData.keyword,
            txt_1_relation: "#CNKI_AND",
            txt_1_special1: "=",
            au_1_sel: "AU",
            au_1_sel2: "AF",
            au_1_value1: fileData.author,
            au_1_special1: "=",
            au_1_special2: "%",
            his: "0",
            __: Date() + " (中国标准时间)",
        };
        var urlEncodedDataPairs = [];
        for (name in static_post_data) {
            urlEncodedDataPairs.push(
                encodeURIComponent(name) +
                    "=" +
                    encodeURIComponent(static_post_data[name])
            );
        }
        return urlEncodedDataPairs.join("&").replace(/%20/g, "+");
    },

    selectRow: function (rowSelectors) {
        Zotero.debug("**Jasminum select window start");
        var io = { dataIn: rowSelectors, dataOut: null };
        var newDialog = window.openDialog(
            "chrome://zotero/content/ingester/selectitems.xul",
            "_blank",
            "chrome,modal,centerscreen,resizable=yes",
            io
        );
        return io.dataOut;
    },

    getIDFromUrl: function (url) {
        if (!url) return false;
        // add regex for navi.cnki.net
        var dbname = url.match(/[?&](?:db|table)[nN]ame=([^&#]*)/i);
        var filename = url.match(/[?&]filename=([^&#]*)/i);
        var dbcode = url.match(/[?&]dbcode=([^&#]*)/i);
        if (
            !dbname ||
            !dbname[1] ||
            !filename ||
            !filename[1] ||
            !dbcode ||
            !dbcode[1] ||
            dbname[1].match("TEMP$")
        )
            return false;
        return { dbname: dbname[1], filename: filename[1], dbcode: dbcode[1] };
    },

    promiseGet: function (url) {
        Zotero.debug("** Jasminum create http get.");
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open("GET", url);
            xhr.onload = function () {
                if (this.status === 200) {
                    resolve(xhr.response);
                } else {
                    reject({
                        status: this.status,
                        statusText: xhr.statusText,
                    });
                }
            };
            xhr.onerror = function () {
                reject({
                    status: this.status,
                    statusText: xhr.statusText,
                });
            };
            xhr.send();
        });
    },

    searchPrepare: async function (fileData) {
        var searchData = await Zotero.Jasminum.createPost(fileData);
        var SEARCH_HANDLE_URL =
            "https://kns.cnki.net/kns/request/SearchHandler.ashx";
        var url = SEARCH_HANDLE_URL + "?" + searchData;
        Zotero.debug("**Jasminum start prepare");
        var searchPrepareOut = await Zotero.Jasminum.promiseGet(url);
        return searchPrepareOut;
    },

    search: async function (searchPrepareOut, fileData) {
        Zotero.debug("**Jasminum start search");
        var keyword = encodeURI(fileData.keyword);
        Zotero.debug("**Jasminum  keyword: " + keyword);
        var resultUrl =
            "https://kns.cnki.net/kns/brief/brief.aspx?pagename=" +
            searchPrepareOut +
            `&t=${Date.parse(new Date())}&keyValue=${keyword}&S=1&sorttype=`;
        Zotero.debug(resultUrl);
        var searchResult = await Zotero.Jasminum.promiseGet(resultUrl);
        var targetRow = Zotero.Jasminum.getSearchItems(searchResult);
        return targetRow;
    },

    getSearchItems: function (resptext) {
        Zotero.debug("**Jasminum get item from search");
        var parser = new DOMParser();
        var html = parser.parseFromString(resptext, "text/html");
        var rows = html.querySelectorAll("table.GridTableContent > tbody > tr");
        Zotero.debug("**Jasminum 搜索结果：" + (rows.length - 1));
        var targetRow;
        if (rows.length <= 1) {
            Zotero.debug("**Jasminum No items found.");
            return null;
        } else if (rows.length == 2) {
            targetRow = rows[1];
        } else {
            // Get the right item from search result.
            var rowIndicators = {};
            for (let idx = 1; idx < rows.length; idx++) {
                var rowText = rows[idx].textContent.split(/\s+/).join(" ");
                rowIndicators[idx] = rowText;
                Zotero.debug(rowText);
            }
            var targetIndicator = Zotero.Jasminum.selectRow(rowIndicators);
            // Zotero.debug(targetIndicator);
            // No item selected, return null
            if (!targetIndicator) return null;
            targetRow = rows[Object.keys(targetIndicator)[0]];
        }
        // Zotero.debug(targetRow.textContent);
        return targetRow;
    },

    getRefworks: async function (targetRow) {
        Zotero.debug("**Jasminum start get ref");
        if (targetRow == null) {
            return new Error("No items returned from the CNKI");
        }
        var targetUrl = targetRow.getElementsByClassName("fz14")[0].href;
        var targetID = Zotero.Jasminum.getIDFromUrl(targetUrl);
        Zotero.debug(targetID);
        // Get reference data from CNKI by ID.
        var postData =
            "formfilenames=" +
            encodeURIComponent(
                targetID.dbname + "!" + targetID.filename + "!1!0,"
            ) +
            "&hid_kLogin_headerUrl=/KLogin/Request/GetKHeader.ashx%3Fcallback%3D%3F" +
            "&hid_KLogin_FooterUrl=/KLogin/Request/GetKHeader.ashx%3Fcallback%3D%3F" +
            "&CookieName=FileNameS";
        var url =
            "https://kns.cnki.net/kns/ViewPage/viewsave.aspx?displayMode=Refworks&" +
            postData;
        var resp = await Zotero.Jasminum.promiseGet(url);
        // Zotero.debug(resp);
        var parser = new DOMParser();
        var html = parser.parseFromString(resp, "text/html");
        var data = Zotero.Utilities.xpath(
            html,
            "//table[@class='mainTable']//td"
        )[0]
            .innerHTML.replace(/<br>/g, "\n")
            .replace(
                /^RT\s+Conference Proceeding/gim,
                "RT Conference Proceedings"
            )
            .replace(/^RT\s+Dissertation\/Thesis/gim, "RT Dissertation")
            .replace(/^(A[1-4]|U2)\s*([^\r\n]+)/gm, function (m, tag, authors) {
                authors = authors.split(/\s*[;，,]\s*/); // that's a special comma
                if (!authors[authors.length - 1].trim()) authors.pop();
                return tag + " " + authors.join("\n" + tag + " ");
            });
        var data = data.replace(/vo (\d+)\n/, "VO $1\n"); // Divide VO and IS to different line.
        targetUrl = `https://kns.cnki.net/KCMS/detail/detail.aspx?dbcode=${targetID.dbcode}&dbname=${targetID.dbname}&filename=${targetID.filename}&v=`;
        Zotero.debug(data);
        return [data, targetUrl];
    },

    promiseTranslate: async function (translate, libraryID) {
        Zotero.debug("** Jasminum translate begin ...");
        translate.setHandler("select", function (translate, items, callback) {
            for (let i in items) {
                let obj = {};
                obj[i] = items[i];
                callback(obj);
                return;
            }
        });

        let newItems = await translate.translate({
            libraryID: libraryID,
            saveAttachments: false,
        });
        if (newItems.length) {
            Zotero.debug(newItems[0]);
            Zotero.debug("** Jasminum translate end.");
            return newItems[0];
        }
        throw new Error("No items found");
    },

    fixItem: function (newItem, targetUrl) {
        var creators = newItem.getCreators();
        for (var i = 0; i < creators.length; i++) {
            var creator = creators[i];
            if (creator.firstName) continue;

            var lastSpace = creator.lastName.lastIndexOf(" ");
            if (
                creator.lastName.search(/[A-Za-z]/) !== -1 &&
                lastSpace !== -1
            ) {
                // western name. split on last space
                creator.firstName = creator.lastName.substr(0, lastSpace);
                creator.lastName = creator.lastName.substr(lastSpace + 1);
            } else {
                // Chinese name. first character is last name, the rest are first name
                creator.firstName = creator.lastName.substr(1);
                creator.lastName = creator.lastName.charAt(0);
            }
            creators[i] = creator;
        }
        newItem.setCreators(creators);
        // Clean up abstract
        if (newItem.getField("abstractNote")) {
            newItem.setField(
                "abstractNote",
                newItem
                    .getField("abstractNote")
                    .replace(/\s*[\r\n]\s*/g, "\n")
                    .replace(/&lt;.*?&gt;/g, "")
            );
        }
        // Remove wront CN field.
        newItem.setField("callNumber", "");
        newItem.setField("libraryCatalog", "CNKI");
        newItem.setField("url", targetUrl);
        // Keep tags according global config.
        if (Zotero.Prefs.get("automaticTags") === false) {
            newItem.tags = [];
        }
        if (newItem.getNotes()) {
            Zotero.Items.erase(newItem.getNotes());
        }
        return newItem;
    },

    updateItems: async function (items) {
        var zp = Zotero.getActiveZoteroPane();
        if (items.length == 0) return;
        var item = items.shift();
        var itemCollections = item.getCollections();
        var libraryID = item.libraryID;
        if (!Zotero.Jasminum.checkItem(item)) return; // TODO Need notify
        var fileData = Zotero.Jasminum.splitFilename(item.getFilename());
        Zotero.debug(fileData);
        var searchPrepareOut = await Zotero.Jasminum.searchPrepare(fileData);
        Zotero.debug("searchPrepareOut");
        Zotero.debug(searchPrepareOut);
        var targetRow = await Zotero.Jasminum.search(
            searchPrepareOut,
            fileData
        );
        Zotero.debug("targetRow");
        Zotero.debug(targetRow.textContent);
        var [data, targetUrl] = await Zotero.Jasminum.getRefworks(targetRow);
        var translate = new Zotero.Translate.Import();
        translate.setTranslator("1a3506da-a303-4b0a-a1cd-f216e6138d86");
        translate.setString(data);
        var newItem = await Zotero.Jasminum.promiseTranslate(
            translate,
            libraryID
        );
        Zotero.debug(newItem);
        newItem = Zotero.Jasminum.fixItem(newItem, targetUrl);
        Zotero.debug("** Jasminum DB trans ...");
        if (itemCollections.length) {
            for (let collectionID of itemCollections) {
                newItem.addToCollection(collectionID);
            }
        }

        // Put old item as a child of the new item
        item.parentID = newItem.id;
        await item.saveTx();
        await newItem.saveTx();
        if (items.length) {
            Zotero.Jasminum.updateItems(items);
        }
        Zotero.debug("** Jasminum finished.");
    },

    checkItemPDF: function (item) {
        return (
            !item.isTopLevelItem() &&
            item.isAttachment() &&
            item.attachmentContentType &&
            item.attachmentContentType === "application/pdf" &&
            item.parentItem.getField("libraryCatalog") &&
            item.parentItem.getField("libraryCatalog").includes("CNKI") &&
            Zotero.ItemTypes.getName(item.parentItem.itemTypeID) === "thesis"
        );
    },

    getChapterUrl: async function (itemUrl) {
        Zotero.debug("** Jasminum get chapter url.");
        var respText = await Zotero.Jasminum.promiseGet(itemUrl);
        var parser = new DOMParser();
        var respHTML = parser.parseFromString(respText, "text/html");
        var chapterDown = Zotero.Utilities.xpath(
            respHTML,
            "//a[contains(text(), '分章下载')]"
        );
        if (chapterDown.length === 0) {
            Zotero.debug("No chapter found.");
            return null;
        }
        var readerUrl = Zotero.Utilities.xpath(
            respHTML,
            "//a[contains(text(), '在线阅读')]"
        )[0].href;
        Zotero.debug("** Jasminum reader url: " + readerUrl);
        var respText = await Zotero.Jasminum.promiseGet(readerUrl);
        var parser = new DOMParser();
        var respHTML = parser.parseFromString(respText, "text/html");
        var chapterUrl = Zotero.Utilities.xpath(
            respHTML,
            "//iframe[@id='treeView']"
        )[0].getAttribute("src");
        Zotero.debug("** Jasminum chapter url: " + chapterUrl);
        return "https://kreader.cnki.net/Kreader/" + chapterUrl;
    },

    getBookmark: async function (item) {
        // demo url     https://kreader.cnki.net/Kreader/buildTree.aspx?dbCode=cdmd&FileName=1020622678.nh&TableName=CMFDTEMP&sourceCode=GHSFU&date=&year=2020&period=&fileNameList=&compose=&subscribe=&titleName=&columnCode=&previousType=_&uid=
        var parentItem = item.parentItem;
        var itemUrl = "";
        var itemChapterUrl = "";

        if (
            // 匹配知网 URL
            parentItem.getField("url") &&
            parentItem.getField("url").match(/^https?:\/\/([^/]+\.)?cnki\.net/)
        ) {
            Zotero.debug("2");
            itemUrl = parentItem.getField("url");
            Zotero.debug("** Jasminum item url: " + itemUrl);
            itemChapterUrl = await Zotero.Jasminum.getChapterUrl(itemUrl);
        } else {
            Zotero.debug("3");
            var fileData = {
                keyword: parentItem.getField("title"),
                author:
                    parentItem.getCreator(0).lastName +
                    parentItem.getCreator(0).firstName,
            };
            var searchPrepareOut = await Zotero.Jasminum.searchPrepare(
                fileData
            );
            var targetRow = await Zotero.Jasminum.search(
                searchPrepareOut,
                fileData
            );
            itemUrl = targetRow.querySelector("a.fz14").getAttribute("href");
            itemUrl = "https://kns.cnki.net/KCMS" + itemUrl.slice(4);
            itemChapterUrl = await Zotero.Jasminum.getChapterUrl(itemUrl);
            // 获取文献链接URL -> 获取章节目录URL
        }
        Zotero.debug("** Jasminum item url: " + itemUrl);
        Zotero.debug("** Jasminum item chapter url: " + itemChapterUrl);
        var chapterText = await Zotero.Jasminum.promiseGet(itemChapterUrl);
        var parser = new DOMParser();
        var chapterHTML = parser.parseFromString(chapterText, "text/html");
        var tree = chapterHTML.getElementById("treeDiv");
        var rows = tree.querySelectorAll("tr");
        var rows_array = [];
        for (let row of rows) {
            Zotero.debug(row.textContent.trim());
            var cols = row.querySelectorAll("td");
            var level = cols.length - 1;
            var title = row.textContent.trim();
            var onclickText = cols[cols.length - 1]
                .querySelector("a")
                .getAttribute("onclick");
            var pageRex = onclickText.match(/CDMDNodeClick\('(\d+)'/);
            var page = pageRex[1];
            var bookmark = `BookmarkBegin\nBookmarkTitle: ${title}\nBookmarkLevel: ${level}\nBookmarkPageNumber: ${page}`;
            rows_array.push(bookmark);
        }
        var bookmark = rows_array.join("\n");
        return bookmark;
    },

    addBookmark: async function (item, bookmark) {
        Zotero.debug("** Jasminum add bookmark begin");
        Zotero.debug(item);
        let cacheFile = Zotero.getTempDirectory();
        cacheFile.append("bookmark.txt");
        let tmpDir = OS.Path.dirname(cacheFile.path);
        if (cacheFile.exists()) {
            cacheFile.remove(false);
        }

        let cachePDF = Zotero.getTempDirectory();
        cachePDF.append("output.pdf");
        if (cachePDF.exists()) {
            cachePDF.remove(false);
        }

        let encoder = new TextEncoder();
        let array = encoder.encode(bookmark);
        let promise = OS.File.writeAtomic(cacheFile.path, array, {
            tmpPath: cacheFile.path + ".tmp",
        });
        var pdftk = Zotero.Prefs.get("jasminum.pdftkpath");
        if (Zotero.isWin) {
            pdftk = OS.Path.join(pdftk, "pdftk.exe");
        } else {
            pdftk = OS.Path.join(pdftk, "pdftk");
        }
        Zotero.debug("** Jasminum pdftk path: " + pdftk);
        var args = [
            item.getFilePath(),
            "update_info_utf8",
            cacheFile.path,
            "output",
            cachePDF.path,
        ];
        Zotero.debug(
            "PDFtk: Running " +
                pdftk +
                " " +
                args.map((arg) => "'" + arg + "'").join(" ")
        );
        try {
            await Zotero.Utilities.Internal.exec(pdftk, args);
            Zotero.debug("PDFtk: Add bookmark:");
            await Zotero.Jasminum.updateBookmarkAttachment(item, cachePDF.path);
            cacheFile.remove(false);
            cachePDF.remove(false);
            Zotero.debug("** Jasminum add bookmark complete!");
        } catch (e) {
            Zotero.logError(e);
            try {
                cacheFile.remove(false);
                cachePDF.remove(false);
            } catch (e) {
                Zotero.logError(e);
            }
            throw new Zotero.Exception.Alert("PDFtk add bookmark failed.");
        }
    },

    updateBookmarkAttachment: async function (item, markedpdf) {
        var parentItem = item.parentItem;
        var parentItemID = parentItem.id;
        var libraryID = parentItem.libraryID;
        var fileBaseName = item.getFilename().replace(/\.pdf/g, "");
        Zotero.debug(parentItemID + fileBaseName + markedpdf + libraryID);
        var file = markedpdf;
        var newItem = await Zotero.Attachments.importFromFile({
            file,
            libraryID,
            fileBaseName,
            parentItemID,
        });
        await newItem.saveTx();
        // delete old attachment
        Zotero.Items.erase(item.id);
    },

    addBookmarkItem: async function () {
        var item = ZoteroPane.getSelectedItems()[0];
        if (!(await Zotero.Jasminum.checkPath())) {
            alert(
                "Can't find PDFtk Server execute file. Please install PDFtk Server and choose the folder in the Jasminum preference window."
            );
            return false;
        }
        var bookmark = await Zotero.Jasminum.getBookmark(item);
        await Zotero.Jasminum.addBookmark(item, bookmark);
    },

    checkPath: async function () {
        Zotero.debug("** Jasminum check path.");
        var pdftkpath = Zotero.Prefs.get("jasminum.pdftkpath");
        Zotero.debug(pdftkpath);
        var pdftk = "";
        if (Zotero.isWin) {
            Zotero.debug("1");
            pdftk = OS.Path.join(pdftkpath, "pdftk.exe");
        } else {
            Zotero.debug("2");
            pdftk = OS.Path.join(pdftkpath, "pdftk");
        }
        Zotero.debug(pdftk);
        var fileExist = await OS.File.exists(pdftk);
        Zotero.debug(fileExist);
        return fileExist;
    },

    checkItemName: function (item) {
        return item.isRegularItem() && item.isTopLevelItem();
    },

    splitName: async function () {
        var items = ZoteroPane.getSelectedItems();
        for (let item of items) {
            var creators = item.getCreators();
            for (var i = 0; i < creators.length; i++) {
                var creator = creators[i];
                if (
                    // English Name pass
                    creator.lastName.search(/[A-Za-z]/) !== -1 ||
                    creator.firstName.search(/[A-Za-z]/) !== -1 ||
                    creator.firstName // 如果有姓就不拆分了
                ) {
                    continue;
                }

                var chineseName = creator.lastName
                    ? creator.lastName
                    : creator.firstName;
                creator.lastName = chineseName.charAt(0);
                creator.firstName = chineseName.substr(1);
                creator.fieldMode = 0;
                creators[i] = creator;
            }
            if (creators != item.getCreators()) {
                item.setCreators(creators);
                item.saveTx();
            }
        }
    },

    mergeName: async function () {
        var items = ZoteroPane.getSelectedItems();
        for (let item of items) {
            var creators = item.getCreators();
            for (var i = 0; i < creators.length; i++) {
                var creator = creators[i];
                if (
                    // English Name pass
                    creator.lastName.search(/[A-Za-z]/) !== -1 ||
                    creator.lastName.search(/[A-Za-z]/) !== -1
                ) {
                    continue;
                }
                creator.lastName = creator.lastName + creator.firstName;
                creator.firstName = "";
                creator.fieldMode = 1;
                creators[i] = creator;
            }
            if (creators != item.getCreators()) {
                item.setCreators(creators);
                item.saveTx();
            }
        }
    },
};

window.addEventListener(
    "load",
    function (e) {
        Zotero.Jasminum.init();
        if (window.ZoteroPane) {
            var doc = window.ZoteroPane.document;
            // add event listener for zotfile menu items
            doc.getElementById("zotero-itemmenu").addEventListener(
                "popupshowing",
                Zotero.Jasminum.displayMenuitem,
                false
            );
        }
    },
    false
);
