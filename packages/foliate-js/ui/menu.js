const createMenuItemRadioGroup = (label, arr, onclick) => {
    const group = document.createElement('ul')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', label)
    const map = new Map()
    const select = value => {
        onclick(value)
        const item = map.get(value)
        for (const child of group.children)
            child.setAttribute('aria-checked', child === item ? 'true' : 'false')
    }
    for (const [label, value] of arr) {
        const item = document.createElement('li')
        item.setAttribute('role', 'menuitemradio')
        item.innerText = label
        item.onclick = () => select(value)
        map.set(value, item)
        group.append(item)
    }
    return { element: group, select }
}

export const createMenu = arr => {
    const groups = {}
    const element = document.createElement('ul')
    element.setAttribute('role', 'menu')
    const hide = () => element.classList.remove('show')
    const hideAnd = f => (...args) => (hide(), f(...args))
    for (const { name, label, type, items, onclick } of arr) {
        const widget = type === 'radio'
            ? createMenuItemRadioGroup(label, items, hideAnd(onclick))
            : null
        if (name) groups[name] = widget
        element.append(widget.element)
    }
    // TODO: keyboard events
    window.addEventListener('blur', () => hide())
    window.addEventListener('click', e => {
        if (!element.parentNode.contains(e.target)) hide()
    })
    return { element, groups }
}
