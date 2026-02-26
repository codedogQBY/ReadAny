import * as CFI from '../epubcfi.js'

const parser = new DOMParser()
const XML = str => parser.parseFromString(str, 'application/xml')
const XHTML = str => parser.parseFromString(str, 'application/xhtml+xml')

{
    // example from EPUB CFI spec
    const opf = XML(`<?xml version="1.0"?>

<package version="2.0" 
         unique-identifier="bookid" 
         xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/" 
         xmlns:opf="http://www.idpf.org/2007/opf">
    
    <metadata>
    	<dc:title>…</dc:title>
    	<dc:identifier id="bookid">…</dc:identifier>
    	<dc:creator>…</dc:creator>
        <dc:language>en</dc:language>
    </metadata>
    
    <manifest>
        <item id="toc"
              properties="nav"
              href="toc.xhtml" 
              media-type="application/xhtml+xml"/>
        <item id="titlepage" 
              href="titlepage.xhtml" 
              media-type="application/xhtml+xml"/>
        <item id="chapter01" 
              href="chapter01.xhtml" 
              media-type="application/xhtml+xml"/>
        <item id="chapter02" 
              href="chapter02.xhtml" 
              media-type="application/xhtml+xml"/>
        <item id="chapter03" 
              href="chapter03.xhtml" 
              media-type="application/xhtml+xml"/>
        <item id="chapter04" 
              href="chapter04.xhtml" 
              media-type="application/xhtml+xml"/>
    </manifest>
    
    <spine>
        <itemref id="titleref"  idref="titlepage"/>
        <itemref id="chap01ref" idref="chapter01"/>
        <itemref id="chap02ref" idref="chapter02"/>
        <itemref id="chap03ref" idref="chapter03"/>
        <itemref id="chap04ref" idref="chapter04"/>
    </spine>
    
</package>`)

    const a = opf.getElementById('chap01ref')
    const b = CFI.toElement(opf, CFI.parse('/6/4[chap01ref]')[0])
    const c = CFI.toElement(opf, CFI.parse('/6/4')[0])
    console.assert(a === b)
    console.assert(a === c)
}

{
    // example from EPUB CFI spec
    const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
    <head>
    	<title>…</title>
    </head>
    
    <body id="body01">
    	<p>…</p>
    	<p>…</p>
    	<p>…</p>
    	<p>…</p>
        <p id="para05">xxx<em>yyy</em>0123456789</p>
    	<p>…</p>
    	<p>…</p>
    	<img id="svgimg" src="foo.svg" alt="…"/>
    	<p>…</p>
    	<p>…</p>
    </body>
</html>`)

    // the exact same page with some text nodes removed, CDATA & comment added,
    // and characters changed to entities
    const page2 = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <title>…</title>
    </head>
    <body id="body01">
        <p>…</p><p>…</p><p>…</p><p>…</p>
        <p id="para05">xxx<em>yyy</em><![CDATA[]]><!--comment1--><![CDATA[0123]]>4<!--comment2-->5<![CDATA[67]]>&#56;&#57;</p>
        <p>…</p>
        <p>…</p>
        <img id="svgimg" src="foo.svg" alt="…"/>
        <p>…</p>
        <p>…</p>
    </body>
</html>`)

    // the exact same page with nodes are to be ignored
    const page3 = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
    <head>
        <title>…</title>
    </head>
    <body id="body01">
        <h1 class="reject">This is ignored!</h1>
        <section class="skip">
            <p class="reject">Also ignored</p>
            <p>…</p><p>…</p><p>…</p><p>…</p>
            <p id="para05">xxx<em>yyy</em><span class="reject">Note: we put ignored text in this span but not the other ones because although the CFI library should ignore them, they won't be ignored by DOM Ranges, which will break the tests.</span><span class="skip">0<span class="skip"><span class="reject"><![CDATA[]]></span>123</span></span>45<span class="reject"><img src="icon.svg"/></span>6789</p>
            <p>…</p>
            <p>…</p>
            <img id="svgimg" src="foo.svg" alt="…"/>
            <p>…</p>
            <p>…</p>
        </section>
    </body>
</html>`)

    const filter = node => node.nodeType !== 1 ? NodeFilter.FILTER_ACCEPT
        : node.matches('.reject') ? NodeFilter.FILTER_REJECT
        : node.matches('.skip') ? NodeFilter.FILTER_SKIP
        : NodeFilter.FILTER_ACCEPT

    const test = (page, filter) => {
        for (const cfi of [
            '/4[body01]/10[para05]/3:10',
            '/4[body01]/16[svgimg]',
            '/4[body01]/10[para05]/1:0',
            '/4[body01]/10[para05]/2/1:0',
            '/4[body01]/10[para05]/2/1:3',
        ]) {
            const range = CFI.toRange(page, CFI.parse(cfi), filter)
            const a = CFI.fromRange(range, filter)
            const b = `epubcfi(${cfi})`
            console.assert(a === b, `expected ${b}, got ${a}`)
        }
        for (let i = 0; i < 10; i++) {
            const cfi = `/4/10,/3:${i},/3:${i+1}`
            const range = CFI.toRange(page, CFI.parse(cfi), filter)
            const n = `${i}`
            console.assert(range.toString() === n, `expected ${n}, got ${range}`)
        }
    }
    test(page)
    test(page2)

    test(page, filter)
    test(page2, filter)
    test(page3, filter)
}

{
    // special characters in ID assertions
    const opf = XML(`<?xml version="1.0"?>
<package version="2.0" 
         unique-identifier="bookid" 
         xmlns="http://www.idpf.org/2007/opf"
         xmlns:dc="http://purl.org/dc/elements/1.1/" 
         xmlns:opf="http://www.idpf.org/2007/opf">
    <metadata></metadata>
    <manifest></manifest>
    <spine>
        <itemref id="titleref"  idref="titlepage"/>
        <itemref id="chap0]!/1ref^" idref="chapter01"/>
        <itemref id="chap02ref" idref="chapter02"/>
        <itemref id="chap03ref" idref="chapter03"/>
        <itemref id="chap04ref" idref="chapter04"/>
    </spine>
</package>`)

    const a = opf.getElementById('chap0]!/1ref^')
    const b = CFI.toElement(opf, CFI.parse('/6/4[chap0^]!/1ref^^]')[0])
    console.assert(a === b)

    const page = XHTML(`<html xmlns="http://www.w3.org/1999/xhtml">
    <head>
    	<title>…</title>
    </head>
    <body id="body0]!/1^">
    	<p>…</p>
    	<p>…</p>
    	<p>…</p>
    	<p>…</p>
        <p id="para]/0,/5">xxx<em>yyy</em>0123456789</p>
    	<p>…</p>
    	<p>…</p>
    	<img id="s][vgimg" src="foo.svg" alt="…"/>
    	<p>…</p>
    	<p>…</p>
    </body>
</html>`)

    for (const cfi of [
        '/4[body0^]!/1^^]/10[para^]/0^,/5]/3:10',
        '/4[body0^]!/1^^]/16[s^]^[vgimg]',
        '/4[body0^]!/1^^]/10[para^]/0^,/5]/1:0',
        '/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:0',
        '/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:3',
    ]) {
        const range = CFI.toRange(page, CFI.parse(cfi))
        const a = CFI.fromRange(range)
        const b = `epubcfi(${cfi})`
        console.assert(a === b, `expected ${b}, got ${a}`)
    }
    for (let i = 0; i < 10; i++) {
        const cfi = `/4[body0^]!/1^^]/10[para^]/0^,^/5],/3:${i},/3:${i+1}`
        const range = CFI.toRange(page, CFI.parse(cfi))
        const n = `${i}`
        console.assert(range.toString() === n, `expected ${n}, got ${range}`)
    }
}

{
    for (const [a, b, c] of [
        ['/6/4!/10', '/6/4!/10', 0],
        ['/6/4!/2/3:0', '/6/4!/2', 1],
        ['/6/4!/2/4/6/8/10/3:0', '/6/4!/4', -1],
        [
            '/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]',
            '/6/4!/4/10',
            0,
        ],
        [
            '/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]',
            '/6/4!/4/12',
            -1,
        ],
        ['/6/4', '/6/4!/2', -1],
        ['/6/4!/2', '/6/4!/2!/2', -1],
    ]) {
        const x = CFI.compare(a, b)
        console.assert(x === c, `compare ${a} and ${b}, expected ${c}, got ${x}`)
    }
}
