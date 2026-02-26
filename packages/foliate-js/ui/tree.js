const createSVGElement = tag =>
    document.createElementNS('http://www.w3.org/2000/svg', tag)

const createExpanderIcon = () => {
    const svg = createSVGElement('svg')
    svg.setAttribute('viewBox', '0 0 13 10')
    svg.setAttribute('width', '13')
    svg.setAttribute('height', '13')
    const polygon = createSVGElement('polygon')
    polygon.setAttribute('points', '2 1, 12 1, 7 9')
    svg.append(polygon)
    return svg
}

const createTOCItemElement = (list, map, onclick) => {
    let count = 0
    const makeID = () => `toc-element-${count++}`
    const createItem = ({ label, href, subitems }, depth = 0) => {
        const a = document.createElement(href ? 'a' : 'span')
        a.innerText = label
        a.setAttribute('role', 'treeitem')
        a.tabIndex = -1
        a.style.paddingInlineStart = `${(depth + 1) * 24}px`
        list.push(a)
        if (href) {
            if (!map.has(href)) map.set(href, a)
            a.href = href
            a.onclick = event => {
                event.preventDefault()
                onclick(href)
            }
        } else a.onclick = event => a.firstElementChild?.onclick(event)

        const li = document.createElement('li')
        li.setAttribute('role', 'none')
        li.append(a)
        if (subitems?.length) {
            a.setAttribute('aria-expanded', 'false')
            const expander = createExpanderIcon()
            expander.onclick = event => {
                event.preventDefault()
                event.stopPropagation()
                const expanded = a.getAttribute('aria-expanded')
                a.setAttribute('aria-expanded', expanded === 'true' ? 'false' : 'true')
            }
            a.prepend(expander)
            const ol = document.createElement('ol')
            ol.id = makeID()
            ol.setAttribute('role', 'group')
            a.setAttribute('aria-owns', ol.id)
            ol.replaceChildren(...subitems.map(item => createItem(item, depth + 1)))
            li.append(ol)
        }
        return li
    }
    return createItem
}

// https://www.w3.org/TR/wai-aria-practices-1.2/examples/treeview/treeview-navigation.html
export const createTOCView = (toc, onclick) => {
    const $toc = document.createElement('ol')
    $toc.setAttribute('role', 'tree')
    const list = []
    const map = new Map()
    const createItem = createTOCItemElement(list, map, onclick)
    $toc.replaceChildren(...toc.map(item => createItem(item)))

    const isTreeItem = item => item?.getAttribute('role') === 'treeitem'
    const getParents = function* (el) {
        for (let parent = el.parentNode; parent !== $toc; parent = parent.parentNode) {
            const item = parent.previousElementSibling
            if (isTreeItem(item)) yield item
        }
    }

    let currentItem, currentVisibleParent
    $toc.addEventListener('focusout', () => {
        if (!currentItem) return
        // reset parent focus from last time
        if (currentVisibleParent) currentVisibleParent.tabIndex = -1
        // if current item is visible, let it have the focus
        if (currentItem.offsetParent) {
            currentItem.tabIndex = 0
            return
        }
        // current item is hidden; give focus to the nearest visible parent
        for (const item of getParents(currentItem)) {
            if (item.offsetParent) {
                item.tabIndex = 0
                currentVisibleParent = item
                break
            }
        }
    })

    const setCurrentHref = href => {
        if (currentItem) {
            currentItem.removeAttribute('aria-current')
            currentItem.tabIndex = -1
        }
        const el = map.get(href)
        if (!el) {
            currentItem = list[0]
            currentItem.tabIndex = 0
            return
        }
        for (const item of getParents(el))
            item.setAttribute('aria-expanded', 'true')
        el.setAttribute('aria-current', 'page')
        el.tabIndex = 0
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        currentItem = el
    }

    const acceptNode = node => isTreeItem(node) && node.offsetParent
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    const iter = document.createTreeWalker($toc, 1, { acceptNode })
    const getIter = current => (iter.currentNode = current, iter)

    for (const el of list) el.addEventListener('keydown', event => {
        let stop = false
        const { currentTarget, key } = event
        switch (key) {
            case ' ':
            case 'Enter':
                currentTarget.click()
                stop = true
                break
            case 'ArrowDown':
                getIter(currentTarget).nextNode()?.focus()
                stop = true
                break
            case 'ArrowUp':
                getIter(currentTarget).previousNode()?.focus()
                stop = true
                break
            case 'ArrowLeft':
                if (currentTarget.getAttribute('aria-expanded') === 'true')
                    currentTarget.setAttribute('aria-expanded', 'false')
                else getParents(currentTarget).next()?.value?.focus()
                stop = true
                break
            case 'ArrowRight':
                if (currentTarget.getAttribute('aria-expanded') === 'true')
                    getIter(currentTarget).nextNode()?.focus()
                else if (currentTarget.getAttribute('aria-owns'))
                    currentTarget.setAttribute('aria-expanded', 'true')
                stop = true
                break
            case 'Home':
                list[0].focus()
                stop = true
                break
            case 'End': {
                const last = list[list.length - 1]
                if (last.offsetParent) last.focus()
                else getIter(last).previousNode()?.focus()
                stop = true
                break
            }
        }
        if (stop) {
            event.preventDefault()
            event.stopPropagation()
        }
    })

    return { element: $toc, setCurrentHref }
}
