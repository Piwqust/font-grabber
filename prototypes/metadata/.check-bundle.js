(() => {
  // node_modules/preact/dist/preact.module.js
  var n;
  var l;
  var u;
  var t;
  var i;
  var o;
  var r;
  var e;
  var f;
  var c;
  var s;
  var a;
  var h;
  var p = {};
  var v = [];
  var y = /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;
  var d = Array.isArray;
  function w(n2, l3) {
    for (var u4 in l3) n2[u4] = l3[u4];
    return n2;
  }
  function g(n2) {
    n2 && n2.parentNode && n2.parentNode.removeChild(n2);
  }
  function _(l3, u4, t3) {
    var i3, o3, r3, e3 = {};
    for (r3 in u4) "key" == r3 ? i3 = u4[r3] : "ref" == r3 ? o3 = u4[r3] : e3[r3] = u4[r3];
    if (arguments.length > 2 && (e3.children = arguments.length > 3 ? n.call(arguments, 2) : t3), "function" == typeof l3 && null != l3.defaultProps) for (r3 in l3.defaultProps) void 0 === e3[r3] && (e3[r3] = l3.defaultProps[r3]);
    return m(l3, e3, i3, o3, null);
  }
  function m(n2, t3, i3, o3, r3) {
    var e3 = { type: n2, props: t3, key: i3, ref: o3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: null == r3 ? ++u : r3, __i: -1, __u: 0 };
    return null == r3 && null != l.vnode && l.vnode(e3), e3;
  }
  function k(n2) {
    return n2.children;
  }
  function x(n2, l3) {
    this.props = n2, this.context = l3;
  }
  function S(n2, l3) {
    if (null == l3) return n2.__ ? S(n2.__, n2.__i + 1) : null;
    for (var u4; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) return u4.__e;
    return "function" == typeof n2.type ? S(n2) : null;
  }
  function C(n2) {
    var l3, u4;
    if (null != (n2 = n2.__) && null != n2.__c) {
      for (n2.__e = n2.__c.base = null, l3 = 0; l3 < n2.__k.length; l3++) if (null != (u4 = n2.__k[l3]) && null != u4.__e) {
        n2.__e = n2.__c.base = u4.__e;
        break;
      }
      return C(n2);
    }
  }
  function M(n2) {
    (!n2.__d && (n2.__d = true) && i.push(n2) && !$.__r++ || o != l.debounceRendering) && ((o = l.debounceRendering) || r)($);
  }
  function $() {
    for (var n2, u4, t3, o3, r3, f4, c3, s3 = 1; i.length; ) i.length > s3 && i.sort(e), n2 = i.shift(), s3 = i.length, n2.__d && (t3 = void 0, o3 = void 0, r3 = (o3 = (u4 = n2).__v).__e, f4 = [], c3 = [], u4.__P && ((t3 = w({}, o3)).__v = o3.__v + 1, l.vnode && l.vnode(t3), O(u4.__P, t3, o3, u4.__n, u4.__P.namespaceURI, 32 & o3.__u ? [r3] : null, f4, null == r3 ? S(o3) : r3, !!(32 & o3.__u), c3), t3.__v = o3.__v, t3.__.__k[t3.__i] = t3, N(f4, t3, c3), o3.__e = o3.__ = null, t3.__e != r3 && C(t3)));
    $.__r = 0;
  }
  function I(n2, l3, u4, t3, i3, o3, r3, e3, f4, c3, s3) {
    var a3, h3, y3, d3, w3, g2, _2, m3 = t3 && t3.__k || v, b = l3.length;
    for (f4 = P(u4, l3, m3, f4, b), a3 = 0; a3 < b; a3++) null != (y3 = u4.__k[a3]) && (h3 = -1 == y3.__i ? p : m3[y3.__i] || p, y3.__i = a3, g2 = O(n2, y3, h3, i3, o3, r3, e3, f4, c3, s3), d3 = y3.__e, y3.ref && h3.ref != y3.ref && (h3.ref && B(h3.ref, null, y3), s3.push(y3.ref, y3.__c || d3, y3)), null == w3 && null != d3 && (w3 = d3), (_2 = !!(4 & y3.__u)) || h3.__k === y3.__k ? f4 = A(y3, f4, n2, _2) : "function" == typeof y3.type && void 0 !== g2 ? f4 = g2 : d3 && (f4 = d3.nextSibling), y3.__u &= -7);
    return u4.__e = w3, f4;
  }
  function P(n2, l3, u4, t3, i3) {
    var o3, r3, e3, f4, c3, s3 = u4.length, a3 = s3, h3 = 0;
    for (n2.__k = new Array(i3), o3 = 0; o3 < i3; o3++) null != (r3 = l3[o3]) && "boolean" != typeof r3 && "function" != typeof r3 ? ("string" == typeof r3 || "number" == typeof r3 || "bigint" == typeof r3 || r3.constructor == String ? r3 = n2.__k[o3] = m(null, r3, null, null, null) : d(r3) ? r3 = n2.__k[o3] = m(k, { children: r3 }, null, null, null) : void 0 === r3.constructor && r3.__b > 0 ? r3 = n2.__k[o3] = m(r3.type, r3.props, r3.key, r3.ref ? r3.ref : null, r3.__v) : n2.__k[o3] = r3, f4 = o3 + h3, r3.__ = n2, r3.__b = n2.__b + 1, e3 = null, -1 != (c3 = r3.__i = L(r3, u4, f4, a3)) && (a3--, (e3 = u4[c3]) && (e3.__u |= 2)), null == e3 || null == e3.__v ? (-1 == c3 && (i3 > s3 ? h3-- : i3 < s3 && h3++), "function" != typeof r3.type && (r3.__u |= 4)) : c3 != f4 && (c3 == f4 - 1 ? h3-- : c3 == f4 + 1 ? h3++ : (c3 > f4 ? h3-- : h3++, r3.__u |= 4))) : n2.__k[o3] = null;
    if (a3) for (o3 = 0; o3 < s3; o3++) null != (e3 = u4[o3]) && 0 == (2 & e3.__u) && (e3.__e == t3 && (t3 = S(e3)), D(e3, e3));
    return t3;
  }
  function A(n2, l3, u4, t3) {
    var i3, o3;
    if ("function" == typeof n2.type) {
      for (i3 = n2.__k, o3 = 0; i3 && o3 < i3.length; o3++) i3[o3] && (i3[o3].__ = n2, l3 = A(i3[o3], l3, u4, t3));
      return l3;
    }
    n2.__e != l3 && (t3 && (l3 && n2.type && !l3.parentNode && (l3 = S(n2)), u4.insertBefore(n2.__e, l3 || null)), l3 = n2.__e);
    do {
      l3 = l3 && l3.nextSibling;
    } while (null != l3 && 8 == l3.nodeType);
    return l3;
  }
  function L(n2, l3, u4, t3) {
    var i3, o3, r3, e3 = n2.key, f4 = n2.type, c3 = l3[u4], s3 = null != c3 && 0 == (2 & c3.__u);
    if (null === c3 && null == e3 || s3 && e3 == c3.key && f4 == c3.type) return u4;
    if (t3 > (s3 ? 1 : 0)) {
      for (i3 = u4 - 1, o3 = u4 + 1; i3 >= 0 || o3 < l3.length; ) if (null != (c3 = l3[r3 = i3 >= 0 ? i3-- : o3++]) && 0 == (2 & c3.__u) && e3 == c3.key && f4 == c3.type) return r3;
    }
    return -1;
  }
  function T(n2, l3, u4) {
    "-" == l3[0] ? n2.setProperty(l3, null == u4 ? "" : u4) : n2[l3] = null == u4 ? "" : "number" != typeof u4 || y.test(l3) ? u4 : u4 + "px";
  }
  function j(n2, l3, u4, t3, i3) {
    var o3, r3;
    n: if ("style" == l3) if ("string" == typeof u4) n2.style.cssText = u4;
    else {
      if ("string" == typeof t3 && (n2.style.cssText = t3 = ""), t3) for (l3 in t3) u4 && l3 in u4 || T(n2.style, l3, "");
      if (u4) for (l3 in u4) t3 && u4[l3] == t3[l3] || T(n2.style, l3, u4[l3]);
    }
    else if ("o" == l3[0] && "n" == l3[1]) o3 = l3 != (l3 = l3.replace(f, "$1")), r3 = l3.toLowerCase(), l3 = r3 in n2 || "onFocusOut" == l3 || "onFocusIn" == l3 ? r3.slice(2) : l3.slice(2), n2.l || (n2.l = {}), n2.l[l3 + o3] = u4, u4 ? t3 ? u4.u = t3.u : (u4.u = c, n2.addEventListener(l3, o3 ? a : s, o3)) : n2.removeEventListener(l3, o3 ? a : s, o3);
    else {
      if ("http://www.w3.org/2000/svg" == i3) l3 = l3.replace(/xlink(H|:h)/, "h").replace(/sName$/, "s");
      else if ("width" != l3 && "height" != l3 && "href" != l3 && "list" != l3 && "form" != l3 && "tabIndex" != l3 && "download" != l3 && "rowSpan" != l3 && "colSpan" != l3 && "role" != l3 && "popover" != l3 && l3 in n2) try {
        n2[l3] = null == u4 ? "" : u4;
        break n;
      } catch (n3) {
      }
      "function" == typeof u4 || (null == u4 || false === u4 && "-" != l3[4] ? n2.removeAttribute(l3) : n2.setAttribute(l3, "popover" == l3 && 1 == u4 ? "" : u4));
    }
  }
  function F(n2) {
    return function(u4) {
      if (this.l) {
        var t3 = this.l[u4.type + n2];
        if (null == u4.t) u4.t = c++;
        else if (u4.t < t3.u) return;
        return t3(l.event ? l.event(u4) : u4);
      }
    };
  }
  function O(n2, u4, t3, i3, o3, r3, e3, f4, c3, s3) {
    var a3, h3, p3, v3, y3, _2, m3, b, S2, C3, M2, $2, P2, A3, H, L2, T3, j3 = u4.type;
    if (void 0 !== u4.constructor) return null;
    128 & t3.__u && (c3 = !!(32 & t3.__u), r3 = [f4 = u4.__e = t3.__e]), (a3 = l.__b) && a3(u4);
    n: if ("function" == typeof j3) try {
      if (b = u4.props, S2 = "prototype" in j3 && j3.prototype.render, C3 = (a3 = j3.contextType) && i3[a3.__c], M2 = a3 ? C3 ? C3.props.value : a3.__ : i3, t3.__c ? m3 = (h3 = u4.__c = t3.__c).__ = h3.__E : (S2 ? u4.__c = h3 = new j3(b, M2) : (u4.__c = h3 = new x(b, M2), h3.constructor = j3, h3.render = E), C3 && C3.sub(h3), h3.state || (h3.state = {}), h3.__n = i3, p3 = h3.__d = true, h3.__h = [], h3._sb = []), S2 && null == h3.__s && (h3.__s = h3.state), S2 && null != j3.getDerivedStateFromProps && (h3.__s == h3.state && (h3.__s = w({}, h3.__s)), w(h3.__s, j3.getDerivedStateFromProps(b, h3.__s))), v3 = h3.props, y3 = h3.state, h3.__v = u4, p3) S2 && null == j3.getDerivedStateFromProps && null != h3.componentWillMount && h3.componentWillMount(), S2 && null != h3.componentDidMount && h3.__h.push(h3.componentDidMount);
      else {
        if (S2 && null == j3.getDerivedStateFromProps && b !== v3 && null != h3.componentWillReceiveProps && h3.componentWillReceiveProps(b, M2), u4.__v == t3.__v || !h3.__e && null != h3.shouldComponentUpdate && false === h3.shouldComponentUpdate(b, h3.__s, M2)) {
          for (u4.__v != t3.__v && (h3.props = b, h3.state = h3.__s, h3.__d = false), u4.__e = t3.__e, u4.__k = t3.__k, u4.__k.some(function(n3) {
            n3 && (n3.__ = u4);
          }), $2 = 0; $2 < h3._sb.length; $2++) h3.__h.push(h3._sb[$2]);
          h3._sb = [], h3.__h.length && e3.push(h3);
          break n;
        }
        null != h3.componentWillUpdate && h3.componentWillUpdate(b, h3.__s, M2), S2 && null != h3.componentDidUpdate && h3.__h.push(function() {
          h3.componentDidUpdate(v3, y3, _2);
        });
      }
      if (h3.context = M2, h3.props = b, h3.__P = n2, h3.__e = false, P2 = l.__r, A3 = 0, S2) {
        for (h3.state = h3.__s, h3.__d = false, P2 && P2(u4), a3 = h3.render(h3.props, h3.state, h3.context), H = 0; H < h3._sb.length; H++) h3.__h.push(h3._sb[H]);
        h3._sb = [];
      } else do {
        h3.__d = false, P2 && P2(u4), a3 = h3.render(h3.props, h3.state, h3.context), h3.state = h3.__s;
      } while (h3.__d && ++A3 < 25);
      h3.state = h3.__s, null != h3.getChildContext && (i3 = w(w({}, i3), h3.getChildContext())), S2 && !p3 && null != h3.getSnapshotBeforeUpdate && (_2 = h3.getSnapshotBeforeUpdate(v3, y3)), L2 = a3, null != a3 && a3.type === k && null == a3.key && (L2 = V(a3.props.children)), f4 = I(n2, d(L2) ? L2 : [L2], u4, t3, i3, o3, r3, e3, f4, c3, s3), h3.base = u4.__e, u4.__u &= -161, h3.__h.length && e3.push(h3), m3 && (h3.__E = h3.__ = null);
    } catch (n3) {
      if (u4.__v = null, c3 || null != r3) if (n3.then) {
        for (u4.__u |= c3 ? 160 : 128; f4 && 8 == f4.nodeType && f4.nextSibling; ) f4 = f4.nextSibling;
        r3[r3.indexOf(f4)] = null, u4.__e = f4;
      } else {
        for (T3 = r3.length; T3--; ) g(r3[T3]);
        z(u4);
      }
      else u4.__e = t3.__e, u4.__k = t3.__k, n3.then || z(u4);
      l.__e(n3, u4, t3);
    }
    else null == r3 && u4.__v == t3.__v ? (u4.__k = t3.__k, u4.__e = t3.__e) : f4 = u4.__e = q(t3.__e, u4, t3, i3, o3, r3, e3, c3, s3);
    return (a3 = l.diffed) && a3(u4), 128 & u4.__u ? void 0 : f4;
  }
  function z(n2) {
    n2 && n2.__c && (n2.__c.__e = true), n2 && n2.__k && n2.__k.forEach(z);
  }
  function N(n2, u4, t3) {
    for (var i3 = 0; i3 < t3.length; i3++) B(t3[i3], t3[++i3], t3[++i3]);
    l.__c && l.__c(u4, n2), n2.some(function(u5) {
      try {
        n2 = u5.__h, u5.__h = [], n2.some(function(n3) {
          n3.call(u5);
        });
      } catch (n3) {
        l.__e(n3, u5.__v);
      }
    });
  }
  function V(n2) {
    return "object" != typeof n2 || null == n2 || n2.__b && n2.__b > 0 ? n2 : d(n2) ? n2.map(V) : w({}, n2);
  }
  function q(u4, t3, i3, o3, r3, e3, f4, c3, s3) {
    var a3, h3, v3, y3, w3, _2, m3, b = i3.props || p, k3 = t3.props, x3 = t3.type;
    if ("svg" == x3 ? r3 = "http://www.w3.org/2000/svg" : "math" == x3 ? r3 = "http://www.w3.org/1998/Math/MathML" : r3 || (r3 = "http://www.w3.org/1999/xhtml"), null != e3) {
      for (a3 = 0; a3 < e3.length; a3++) if ((w3 = e3[a3]) && "setAttribute" in w3 == !!x3 && (x3 ? w3.localName == x3 : 3 == w3.nodeType)) {
        u4 = w3, e3[a3] = null;
        break;
      }
    }
    if (null == u4) {
      if (null == x3) return document.createTextNode(k3);
      u4 = document.createElementNS(r3, x3, k3.is && k3), c3 && (l.__m && l.__m(t3, e3), c3 = false), e3 = null;
    }
    if (null == x3) b === k3 || c3 && u4.data == k3 || (u4.data = k3);
    else {
      if (e3 = e3 && n.call(u4.childNodes), !c3 && null != e3) for (b = {}, a3 = 0; a3 < u4.attributes.length; a3++) b[(w3 = u4.attributes[a3]).name] = w3.value;
      for (a3 in b) if (w3 = b[a3], "children" == a3) ;
      else if ("dangerouslySetInnerHTML" == a3) v3 = w3;
      else if (!(a3 in k3)) {
        if ("value" == a3 && "defaultValue" in k3 || "checked" == a3 && "defaultChecked" in k3) continue;
        j(u4, a3, null, w3, r3);
      }
      for (a3 in k3) w3 = k3[a3], "children" == a3 ? y3 = w3 : "dangerouslySetInnerHTML" == a3 ? h3 = w3 : "value" == a3 ? _2 = w3 : "checked" == a3 ? m3 = w3 : c3 && "function" != typeof w3 || b[a3] === w3 || j(u4, a3, w3, b[a3], r3);
      if (h3) c3 || v3 && (h3.__html == v3.__html || h3.__html == u4.innerHTML) || (u4.innerHTML = h3.__html), t3.__k = [];
      else if (v3 && (u4.innerHTML = ""), I("template" == t3.type ? u4.content : u4, d(y3) ? y3 : [y3], t3, i3, o3, "foreignObject" == x3 ? "http://www.w3.org/1999/xhtml" : r3, e3, f4, e3 ? e3[0] : i3.__k && S(i3, 0), c3, s3), null != e3) for (a3 = e3.length; a3--; ) g(e3[a3]);
      c3 || (a3 = "value", "progress" == x3 && null == _2 ? u4.removeAttribute("value") : null != _2 && (_2 !== u4[a3] || "progress" == x3 && !_2 || "option" == x3 && _2 != b[a3]) && j(u4, a3, _2, b[a3], r3), a3 = "checked", null != m3 && m3 != u4[a3] && j(u4, a3, m3, b[a3], r3));
    }
    return u4;
  }
  function B(n2, u4, t3) {
    try {
      if ("function" == typeof n2) {
        var i3 = "function" == typeof n2.__u;
        i3 && n2.__u(), i3 && null == u4 || (n2.__u = n2(u4));
      } else n2.current = u4;
    } catch (n3) {
      l.__e(n3, t3);
    }
  }
  function D(n2, u4, t3) {
    var i3, o3;
    if (l.unmount && l.unmount(n2), (i3 = n2.ref) && (i3.current && i3.current != n2.__e || B(i3, null, u4)), null != (i3 = n2.__c)) {
      if (i3.componentWillUnmount) try {
        i3.componentWillUnmount();
      } catch (n3) {
        l.__e(n3, u4);
      }
      i3.base = i3.__P = null;
    }
    if (i3 = n2.__k) for (o3 = 0; o3 < i3.length; o3++) i3[o3] && D(i3[o3], u4, t3 || "function" != typeof n2.type);
    t3 || g(n2.__e), n2.__c = n2.__ = n2.__e = void 0;
  }
  function E(n2, l3, u4) {
    return this.constructor(n2, u4);
  }
  function G(u4, t3, i3) {
    var o3, r3, e3, f4;
    t3 == document && (t3 = document.documentElement), l.__ && l.__(u4, t3), r3 = (o3 = "function" == typeof i3) ? null : i3 && i3.__k || t3.__k, e3 = [], f4 = [], O(t3, u4 = (!o3 && i3 || t3).__k = _(k, null, [u4]), r3 || p, p, t3.namespaceURI, !o3 && i3 ? [i3] : r3 ? null : t3.firstChild ? n.call(t3.childNodes) : null, e3, !o3 && i3 ? i3 : r3 ? r3.__e : t3.firstChild, o3, f4), N(e3, u4, f4);
  }
  function Q(n2) {
    function l3(n3) {
      var u4, t3;
      return this.getChildContext || (u4 = /* @__PURE__ */ new Set(), (t3 = {})[l3.__c] = this, this.getChildContext = function() {
        return t3;
      }, this.componentWillUnmount = function() {
        u4 = null;
      }, this.shouldComponentUpdate = function(n4) {
        this.props.value != n4.value && u4.forEach(function(n5) {
          n5.__e = true, M(n5);
        });
      }, this.sub = function(n4) {
        u4.add(n4);
        var l4 = n4.componentWillUnmount;
        n4.componentWillUnmount = function() {
          u4 && u4.delete(n4), l4 && l4.call(n4);
        };
      }), n3.children;
    }
    return l3.__c = "__cC" + h++, l3.__ = n2, l3.Provider = l3.__l = (l3.Consumer = function(n3, l4) {
      return n3.children(l4);
    }).contextType = l3, l3;
  }
  n = v.slice, l = { __e: function(n2, l3, u4, t3) {
    for (var i3, o3, r3; l3 = l3.__; ) if ((i3 = l3.__c) && !i3.__) try {
      if ((o3 = i3.constructor) && null != o3.getDerivedStateFromError && (i3.setState(o3.getDerivedStateFromError(n2)), r3 = i3.__d), null != i3.componentDidCatch && (i3.componentDidCatch(n2, t3 || {}), r3 = i3.__d), r3) return i3.__E = i3;
    } catch (l4) {
      n2 = l4;
    }
    throw n2;
  } }, u = 0, t = function(n2) {
    return null != n2 && void 0 === n2.constructor;
  }, x.prototype.setState = function(n2, l3) {
    var u4;
    u4 = null != this.__s && this.__s != this.state ? this.__s : this.__s = w({}, this.state), "function" == typeof n2 && (n2 = n2(w({}, u4), this.props)), n2 && w(u4, n2), null != n2 && this.__v && (l3 && this._sb.push(l3), M(this));
  }, x.prototype.forceUpdate = function(n2) {
    this.__v && (this.__e = true, n2 && this.__h.push(n2), M(this));
  }, x.prototype.render = k, i = [], r = "function" == typeof Promise ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout, e = function(n2, l3) {
    return n2.__v.__b - l3.__v.__b;
  }, $.__r = 0, f = /(PointerCapture)$|Capture$/i, c = 0, s = F(false), a = F(true), h = 0;

  // node_modules/preact/hooks/dist/hooks.module.js
  var t2;
  var r2;
  var u2;
  var i2;
  var o2 = 0;
  var f2 = [];
  var c2 = l;
  var e2 = c2.__b;
  var a2 = c2.__r;
  var v2 = c2.diffed;
  var l2 = c2.__c;
  var m2 = c2.unmount;
  var s2 = c2.__;
  function p2(n2, t3) {
    c2.__h && c2.__h(r2, n2, o2 || t3), o2 = 0;
    var u4 = r2.__H || (r2.__H = { __: [], __h: [] });
    return n2 >= u4.__.length && u4.__.push({}), u4.__[n2];
  }
  function d2(n2) {
    return o2 = 1, h2(D2, n2);
  }
  function h2(n2, u4, i3) {
    var o3 = p2(t2++, 2);
    if (o3.t = n2, !o3.__c && (o3.__ = [i3 ? i3(u4) : D2(void 0, u4), function(n3) {
      var t3 = o3.__N ? o3.__N[0] : o3.__[0], r3 = o3.t(t3, n3);
      t3 !== r3 && (o3.__N = [r3, o3.__[1]], o3.__c.setState({}));
    }], o3.__c = r2, !r2.__f)) {
      var f4 = function(n3, t3, r3) {
        if (!o3.__c.__H) return true;
        var u5 = o3.__c.__H.__.filter(function(n4) {
          return !!n4.__c;
        });
        if (u5.every(function(n4) {
          return !n4.__N;
        })) return !c3 || c3.call(this, n3, t3, r3);
        var i4 = o3.__c.props !== n3;
        return u5.forEach(function(n4) {
          if (n4.__N) {
            var t4 = n4.__[0];
            n4.__ = n4.__N, n4.__N = void 0, t4 !== n4.__[0] && (i4 = true);
          }
        }), c3 && c3.call(this, n3, t3, r3) || i4;
      };
      r2.__f = true;
      var c3 = r2.shouldComponentUpdate, e3 = r2.componentWillUpdate;
      r2.componentWillUpdate = function(n3, t3, r3) {
        if (this.__e) {
          var u5 = c3;
          c3 = void 0, f4(n3, t3, r3), c3 = u5;
        }
        e3 && e3.call(this, n3, t3, r3);
      }, r2.shouldComponentUpdate = f4;
    }
    return o3.__N || o3.__;
  }
  function y2(n2, u4) {
    var i3 = p2(t2++, 3);
    !c2.__s && C2(i3.__H, u4) && (i3.__ = n2, i3.u = u4, r2.__H.__h.push(i3));
  }
  function A2(n2) {
    return o2 = 5, T2(function() {
      return { current: n2 };
    }, []);
  }
  function T2(n2, r3) {
    var u4 = p2(t2++, 7);
    return C2(u4.__H, r3) && (u4.__ = n2(), u4.__H = r3, u4.__h = n2), u4.__;
  }
  function x2(n2) {
    var u4 = r2.context[n2.__c], i3 = p2(t2++, 9);
    return i3.c = n2, u4 ? (null == i3.__ && (i3.__ = true, u4.sub(r2)), u4.props.value) : n2.__;
  }
  function j2() {
    for (var n2; n2 = f2.shift(); ) if (n2.__P && n2.__H) try {
      n2.__H.__h.forEach(z2), n2.__H.__h.forEach(B2), n2.__H.__h = [];
    } catch (t3) {
      n2.__H.__h = [], c2.__e(t3, n2.__v);
    }
  }
  c2.__b = function(n2) {
    r2 = null, e2 && e2(n2);
  }, c2.__ = function(n2, t3) {
    n2 && t3.__k && t3.__k.__m && (n2.__m = t3.__k.__m), s2 && s2(n2, t3);
  }, c2.__r = function(n2) {
    a2 && a2(n2), t2 = 0;
    var i3 = (r2 = n2.__c).__H;
    i3 && (u2 === r2 ? (i3.__h = [], r2.__h = [], i3.__.forEach(function(n3) {
      n3.__N && (n3.__ = n3.__N), n3.u = n3.__N = void 0;
    })) : (i3.__h.forEach(z2), i3.__h.forEach(B2), i3.__h = [], t2 = 0)), u2 = r2;
  }, c2.diffed = function(n2) {
    v2 && v2(n2);
    var t3 = n2.__c;
    t3 && t3.__H && (t3.__H.__h.length && (1 !== f2.push(t3) && i2 === c2.requestAnimationFrame || ((i2 = c2.requestAnimationFrame) || w2)(j2)), t3.__H.__.forEach(function(n3) {
      n3.u && (n3.__H = n3.u), n3.u = void 0;
    })), u2 = r2 = null;
  }, c2.__c = function(n2, t3) {
    t3.some(function(n3) {
      try {
        n3.__h.forEach(z2), n3.__h = n3.__h.filter(function(n4) {
          return !n4.__ || B2(n4);
        });
      } catch (r3) {
        t3.some(function(n4) {
          n4.__h && (n4.__h = []);
        }), t3 = [], c2.__e(r3, n3.__v);
      }
    }), l2 && l2(n2, t3);
  }, c2.unmount = function(n2) {
    m2 && m2(n2);
    var t3, r3 = n2.__c;
    r3 && r3.__H && (r3.__H.__.forEach(function(n3) {
      try {
        z2(n3);
      } catch (n4) {
        t3 = n4;
      }
    }), r3.__H = void 0, t3 && c2.__e(t3, r3.__v));
  };
  var k2 = "function" == typeof requestAnimationFrame;
  function w2(n2) {
    var t3, r3 = function() {
      clearTimeout(u4), k2 && cancelAnimationFrame(t3), setTimeout(n2);
    }, u4 = setTimeout(r3, 35);
    k2 && (t3 = requestAnimationFrame(r3));
  }
  function z2(n2) {
    var t3 = r2, u4 = n2.__c;
    "function" == typeof u4 && (n2.__c = void 0, u4()), r2 = t3;
  }
  function B2(n2) {
    var t3 = r2;
    n2.__c = n2.__(), r2 = t3;
  }
  function C2(n2, t3) {
    return !n2 || n2.length !== t3.length || t3.some(function(t4, r3) {
      return t4 !== n2[r3];
    });
  }
  function D2(n2, t3) {
    return "function" == typeof t3 ? t3(n2) : t3;
  }

  // core/src/web/src/lib/api.js
  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  async function fetchArchive(downloadUrl) {
    const response = await fetch(downloadUrl);
    if (!response.ok)
      throw new Error("The archive is unavailable. Prepare the download again.");
    return response.blob();
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error(`Could not read ${file.name} from your computer.`));
      reader.readAsDataURL(file);
    });
  }
  async function inspectMetadata(source) {
    const response = await fetch("/api/metadata/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source })
    });
    return readJson(response);
  }
  async function applyMetadata({ source, delivery, outputDir, fonts }) {
    const response = await fetch("/api/metadata/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        delivery,
        output_dir: outputDir || null,
        fonts
      })
    });
    return readJson(response);
  }
  function triggerDownload(blob, filename) {
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4e3);
  }

  // core/src/web/src/metadata/derive.js
  var FAMILY_FIELDS = [
    "copyright",
    "trademark",
    "manufacturer",
    "designer",
    "description",
    "vendor_url",
    "designer_url",
    "license",
    "license_url",
    "version"
  ];
  var FACE_FIELDS = ["subfamily", "full_name", "postscript", "filename"];
  var NON_ASCII = /[^\x20-\x7E]/g;
  var POSTSCRIPT_FORBIDDEN = /[[\](){}<>/%\s]/g;
  var FILE_FORBIDDEN = /[^A-Za-z0-9._-]/g;
  function asciiOnly(value) {
    return String(value ?? "").replace(NON_ASCII, "");
  }
  function postscriptSafe(value) {
    return asciiOnly(value).replace(POSTSCRIPT_FORBIDDEN, "");
  }
  function fileSafe(value) {
    return asciiOnly(value).replace(FILE_FORBIDDEN, "");
  }
  function fileStem(file) {
    const name = String(file || "");
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }
  function deriveFullName(family, subfamily) {
    return [family.trim(), subfamily.trim()].filter(Boolean).join(" ");
  }
  function derivePostscript(family, subfamily) {
    const left = postscriptSafe(family);
    const right = postscriptSafe(subfamily);
    return (right ? `${left}-${right}` : left).slice(0, 63);
  }
  function deriveFilename(postscript) {
    return fileSafe(postscript).slice(0, 80);
  }
  function normalizeVersion(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return "";
    const match = /^(?:version\s+)?(\d{1,5})(?:[.,](\d{1,5}))?$/i.exec(text);
    if (!match) return null;
    const minor = (match[2] || "0").padEnd(3, "0").slice(0, 3);
    return `Version ${Number(match[1])}.${minor}`;
  }
  function urlProblem(value) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    try {
      const parsed = new URL(text);
      if (!["http:", "https:"].includes(parsed.protocol))
        return "Use an http:// or https:// address.";
      return null;
    } catch {
      return "Use a full address, such as https://example.com.";
    }
  }

  // node_modules/preact/jsx-runtime/dist/jsxRuntime.module.js
  var f3 = 0;
  function u3(e3, t3, n2, o3, i3, u4) {
    t3 || (t3 = {});
    var a3, c3, p3 = t3;
    if ("ref" in p3) for (c3 in p3 = {}, t3) "ref" == c3 ? a3 = t3[c3] : p3[c3] = t3[c3];
    var l3 = { type: e3, props: p3, key: n2, ref: a3, __k: null, __: null, __b: 0, __e: null, __c: null, constructor: void 0, __v: --f3, __i: -1, __u: 0, __source: i3, __self: u4 };
    if ("function" == typeof e3 && (a3 = e3.defaultProps)) for (c3 in a3) void 0 === p3[c3] && (p3[c3] = a3[c3]);
    return l.vnode && l.vnode(l3), l3;
  }

  // prototypes/metadata/model.jsx
  var Context = Q(null);
  var empty = () => ({ families: {}, faces: {} });
  var demoFiles = ["geist-400.woff2", "geist-600.woff2", "geist-800.woff2", "newsreader-400.woff2", "newsreader-400i.woff2", "newsreader-700.woff2"];
  function Model({ children }) {
    const [fonts, setFonts] = d2([]), [draft, setDraft] = d2(empty), [group, setGroup] = d2(""), [busy, setBusy] = d2("Loading sample fonts"), [error, setError] = d2(""), [report, setReport] = d2(null), [notice, setNotice] = d2(""), [origin, setOrigin] = d2("Sample fonts"), [sample, setSample] = d2("The shape of things.");
    const filesRef = A2([]), uploadRef = A2(null), loadedRef = A2([]), operation = A2(false), generation = A2(0);
    async function loadFiles(files, label = "Your files") {
      if (operation.current) return;
      operation.current = true;
      setBusy("Reading font metadata");
      setError("");
      try {
        if (!files.length || files.length > 16) throw new Error("Choose between 1 and 16 font files.");
        if (files.some((file) => file.size > 20 * 1024 * 1024)) throw new Error("Each font must be 20 MB or smaller.");
        if (files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) throw new Error("Choose at most 64 MB of fonts.");
        const uploaded = await Promise.all(files.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })));
        const data = await inspectMetadata({ kind: "upload", files: uploaded });
        if (!data.fonts?.length) throw new Error(data.failures?.map((item) => item.error).join("; ") || "These files could not be read. Choose another font.");
        for (const face of loadedRef.current) document.fonts.delete(face);
        loadedRef.current = [];
        const token = ++generation.current;
        const inspected = await Promise.all(data.fonts.map(async (font, index) => {
          const previewFamily = "FountPreview" + token + "_" + index;
          try {
            const face = new FontFace(previewFamily, await files[index].arrayBuffer());
            await face.load();
            document.fonts.add(face);
            loadedRef.current.push(face);
            return { ...font, previewFamily };
          } catch {
            return { ...font, previewFamily: "Geist" };
          }
        }));
        filesRef.current = files;
        uploadRef.current = { id: data.upload_id, created: Date.now() };
        setFonts(inspected);
        setGroup(inspected[0].names.family || "Unnamed family");
        setDraft(empty());
        setReport(null);
        setNotice("");
        setOrigin(label);
      } catch (err) {
        setError(err.message);
      } finally {
        operation.current = false;
        setBusy("");
      }
    }
    async function loadSamples() {
      if (operation.current) return;
      setBusy("Loading sample fonts");
      try {
        const files = await Promise.all(demoFiles.map(async (name) => {
          const response = await fetch("/assets/" + name);
          if (!response.ok) throw new Error("Sample fonts are unavailable. Choose files from your computer.");
          return new File([await response.blob()], name, { type: "font/woff2" });
        }));
        await loadFiles(files, "Sample fonts");
      } catch (err) {
        setError(err.message);
        setBusy("");
      }
    }
    y2(() => {
      loadSamples();
      return () => {
        for (const face of loadedRef.current) document.fonts.delete(face);
      };
    }, []);
    const familyOf = (font) => font.names.family || "Unnamed family";
    const groups = [...new Set(fonts.map(familyOf))], familyFonts = fonts.filter((font) => familyOf(font) === group);
    function effective(font) {
      const common = draft.families[familyOf(font)] || {}, face = draft.faces[font.id] || {}, family = common.family ?? font.names.family ?? "", subfamily = face.subfamily ?? font.names.subfamily ?? "Regular", namingChanged = common.family !== void 0 || face.subfamily !== void 0;
      const full_name = face.full_name ?? (namingChanged ? deriveFullName(family, subfamily) : font.names.full_name || deriveFullName(family, subfamily));
      const postscript = face.postscript ?? (namingChanged ? derivePostscript(family, subfamily) : font.names.postscript || derivePostscript(family, subfamily));
      const filename = face.filename ?? (namingChanged ? deriveFilename(postscript) : fileStem(font.file));
      return { ...font.names, ...common, family, subfamily, full_name, postscript, filename };
    }
    function changes(font) {
      const values = effective(font), result = [];
      for (const key of ["family", ...FACE_FIELDS, ...FAMILY_FIELDS]) {
        const before = key === "filename" ? fileStem(font.file) : font.names[key] || "", after = key === "version" && draft.families[familyOf(font)]?.version !== void 0 ? normalizeVersion(values[key]) : values[key] || "";
        if (after !== before) result.push({ key, before, after });
      }
      return result;
    }
    const changed = fonts.filter((font) => changes(font).length);
    function mutate(update) {
      setDraft(update);
      setReport(null);
      setNotice("");
    }
    function setFamily(key, value) {
      mutate((old) => ({ ...old, families: { ...old.families, [group]: { ...old.families[group], [key]: value } } }));
    }
    function resetFamily(key) {
      mutate((old) => {
        const common = { ...old.families[group] };
        delete common[key];
        return { ...old, families: { ...old.families, [group]: common } };
      });
    }
    function setFace(id, key, value) {
      mutate((old) => ({ ...old, faces: { ...old.faces, [id]: { ...old.faces[id], [key]: value } } }));
    }
    function resetFace(id) {
      mutate((old) => {
        const face = { ...old.faces[id] };
        for (const key of FACE_FIELDS) delete face[key];
        return { ...old, faces: { ...old.faces, [id]: face } };
      });
    }
    function manual(font, on) {
      if (!on) return resetFace(font.id);
      const values = effective(font);
      mutate((old) => ({ ...old, faces: { ...old.faces, [font.id]: Object.fromEntries(FACE_FIELDS.map((key) => [key, values[key]])) } }));
    }
    function shared(key) {
      const values = new Set(familyFonts.map((font) => font.names[key] || ""));
      return { mixed: values.size > 1, original: values.size === 1 ? [...values][0] : "", value: draft.families[group]?.[key] ?? (values.size === 1 ? [...values][0] : "") };
    }
    const issues = [];
    for (const font of fonts) {
      const value = effective(font), add = (key, message) => issues.some((item) => item.id === font.id && item.key === key) || issues.push({ id: font.id, key, message });
      if (!value.family.trim()) add("family", "Enter a family name.");
      if (!value.subfamily.trim()) add("subfamily", "Enter a style name.");
      if (!value.full_name.trim()) add("full_name", "Enter a full name.");
      if (!value.postscript || !/^[\x21-\x7e]+$/.test(value.postscript) || /[[\](){}<>/%]/.test(value.postscript) || value.postscript.length > 63) add("postscript", "Use 1 to 63 ASCII characters without spaces or reserved symbols.");
      if (!value.filename || /[<>:\"/\\|?*\x00-\x1f]/.test(value.filename) || /[. ]$/.test(value.filename)) add("filename", "Enter a valid file name without an extension.");
      for (const key of ["vendor_url", "designer_url", "license_url"]) if (draft.families[familyOf(font)]?.[key] !== void 0 && urlProblem(value[key])) add(key, urlProblem(value[key]));
      if (draft.families[familyOf(font)]?.version !== void 0 && normalizeVersion(value.version) === null) add("version", "Enter a version such as 1.000.");
    }
    async function download(ids) {
      if (operation.current || issues.length || !fonts.length) return;
      operation.current = true;
      setBusy("Preparing font copies");
      setReport(null);
      setNotice("");
      try {
        const uploaded = await Promise.all(filesRef.current.map(async (file) => ({ name: file.name, data: await fileToBase64(file) })));
        if (!uploadRef.current?.id) {
          const data = await inspectMetadata({ kind: "upload", files: uploaded });
          uploadRef.current = { id: data.upload_id, created: Date.now() };
        }
        const payload = fonts.filter((font) => !ids || ids.includes(font.id)).map((font) => {
          const entries = changes(font), names = Object.fromEntries(entries.filter((item) => item.key !== "filename").map((item) => [item.key, item.after])), file = entries.find((item) => item.key === "filename");
          return { id: font.id, names, ...file ? { filename: file.after } : {} };
        });
        const result = await applyMetadata({ source: { kind: "upload", upload_id: uploadRef.current.id }, delivery: "zip", fonts: payload });
        setReport(result);
        if (result.download_url) {
          const blob = await fetchArchive(result.download_url);
          if (!blob.size) throw new Error("The archive was empty. Try preparing the files again.");
          triggerDownload(blob, result.filename);
          setNotice(result.saved_count + " of " + result.requested_count + " files prepared. Download started.");
        }
      } catch (err) {
        setError(err.message);
      } finally {
        operation.current = false;
        setBusy("");
      }
    }
    return /* @__PURE__ */ u3(Context.Provider, { value: { fonts, draft, group, setGroup, groups, familyFonts, effective, changes, changed, shared, setFamily, resetFamily, setFace, resetFace, manual, busy, error, report, notice, origin, sample, setSample, issues, loadFiles, loadSamples, download, resetAll() {
      setDraft(empty());
      setReport(null);
      setNotice("Changes reset.");
    } }, children });
  }
  var useModel = () => x2(Context);

  // prototypes/metadata/app.jsx
  function App() {
    const [variant, setVariant] = d2(Number(new URLSearchParams(location.search).get("v")) || 1);
    y2(() => {
      const url = new URL(location);
      url.searchParams.set("v", variant);
      history.replaceState(null, "", url);
    }, [variant]);
    return /* @__PURE__ */ u3(Model, { children: /* @__PURE__ */ u3(Shell, { variant, setVariant }) });
  }
  function Shell({ variant, setVariant }) {
    const model = useModel();
    return /* @__PURE__ */ u3(k, { children: [
      /* @__PURE__ */ u3("div", { class: "prototype-shell", children: [
        /* @__PURE__ */ u3("header", { class: "proto-top", children: [
          /* @__PURE__ */ u3("a", { class: "brand", href: "#", onClick: (event) => event.preventDefault(), children: [
            /* @__PURE__ */ u3("span", { class: "mark", children: "F" }),
            " Fount"
          ] }),
          /* @__PURE__ */ u3("span", { class: "top-context", children: "Metadata directions" }),
          /* @__PURE__ */ u3("div", { class: "top-actions", children: [
            /* @__PURE__ */ u3("label", { class: "file-button", children: [
              "Load files",
              /* @__PURE__ */ u3("input", { id: "prototype-files", type: "file", multiple: true, accept: ".ttf,.otf,.woff,.woff2", onChange: (event) => {
                model.loadFiles([...event.currentTarget.files]);
                event.currentTarget.value = "";
              } })
            ] }),
            /* @__PURE__ */ u3("button", { class: "quiet", onClick: () => {
              document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
            }, children: "\u25D0" }),
            /* @__PURE__ */ u3("button", { class: "quiet", onClick: model.resetAll, children: "\u21BA" }),
            /* @__PURE__ */ u3("span", { class: "edition", children: "PROTOTYPE" })
          ] })
        ] }),
        model.busy && /* @__PURE__ */ u3("div", { class: "loading", role: "status", children: [
          model.busy,
          /* @__PURE__ */ u3("span", { children: "." }),
          /* @__PURE__ */ u3("span", { children: "." }),
          /* @__PURE__ */ u3("span", { children: "." })
        ] }),
        model.error && /* @__PURE__ */ u3("div", { class: "global-error", role: "alert", children: [
          model.error,
          /* @__PURE__ */ u3("button", { onClick: model.loadSamples, children: "Load sample fonts" })
        ] }),
        model.fonts.length > 0 && /* @__PURE__ */ u3("main", { class: "direction direction-" + variant, children: [
          variant === 1 && /* @__PURE__ */ u3(Passport, {}),
          variant === 2 && /* @__PURE__ */ u3(Inspector, {}),
          variant === 3 && /* @__PURE__ */ u3(Steps, {})
        ] }, variant),
        model.fonts.length > 0 && /* @__PURE__ */ u3(ActionBar, {})
      ] }),
      /* @__PURE__ */ u3(Picker, { variant, setVariant })
    ] });
  }
  function Title({ kicker, title, children }) {
    return /* @__PURE__ */ u3("div", { class: "hero-title", children: [
      /* @__PURE__ */ u3("p", { class: "kicker", children: kicker }),
      /* @__PURE__ */ u3("h1", { children: title }),
      children
    ] });
  }
  function FamilyField() {
    const model = useModel();
    const field = model.shared("family");
    return /* @__PURE__ */ u3("label", { class: "family-control", children: [
      /* @__PURE__ */ u3("span", { children: "Family name" }),
      /* @__PURE__ */ u3("input", { value: field.value, placeholder: field.mixed ? "Several values" : "Family name", onInput: (event) => model.setFamily("family", event.currentTarget.value) }),
      field.mixed && /* @__PURE__ */ u3("small", { class: "field-note", children: "Different family names will become one name." }),
      field.value !== field.original && /* @__PURE__ */ u3("small", { class: "field-original", children: [
        "Original: ",
        field.original || "not set",
        /* @__PURE__ */ u3("button", { onClick: () => model.resetFamily("family"), children: "Reset" })
      ] })
    ] });
  }
  function FaceLine({ font, active, setActive, compact = false }) {
    const model = useModel();
    const value = model.effective(font), changed = model.changes(font).length > 0;
    return /* @__PURE__ */ u3("button", { class: "face-line " + (active === font.id ? "is-active" : ""), onClick: () => setActive(font.id), children: [
      /* @__PURE__ */ u3("span", { class: "face-style", children: value.subfamily }),
      /* @__PURE__ */ u3("span", { class: "face-preview", style: { fontFamily: "'" + font.previewFamily + "'" }, children: compact ? value.full_name : model.sample }),
      /* @__PURE__ */ u3("span", { class: "face-output", children: [
        /* @__PURE__ */ u3("b", { children: value.full_name }),
        /* @__PURE__ */ u3("small", { children: [
          value.filename,
          ".",
          font.format === "woff2" ? "otf" : font.format
        ] }),
        changed && /* @__PURE__ */ u3("em", { children: "Changed" })
      ] }),
      /* @__PURE__ */ u3("span", { class: "line-arrow", children: "\u2192" })
    ] });
  }
  function TextField({ label, value = "", placeholder = "Not set", area = false, onInput, error }) {
    const C3 = area ? "textarea" : "input";
    return /* @__PURE__ */ u3("label", { class: "text-field", children: [
      /* @__PURE__ */ u3("span", { children: label }),
      /* @__PURE__ */ u3(C3, { value, placeholder, "aria-invalid": error ? "true" : void 0, onInput }),
      error && /* @__PURE__ */ u3("small", { class: "field-error", children: error })
    ] });
  }
  function DetailRows() {
    const model = useModel();
    const [open, setOpen] = d2({});
    const value = (key) => model.shared(key).value;
    const row = (key, label, summary, content) => /* @__PURE__ */ u3("section", { class: "detail " + (open[key] ? "open" : ""), children: [
      /* @__PURE__ */ u3("button", { class: "detail-toggle", onClick: () => setOpen((old) => ({ ...old, [key]: !old[key] })), children: [
        /* @__PURE__ */ u3("span", { children: label }),
        /* @__PURE__ */ u3("small", { children: summary }),
        /* @__PURE__ */ u3("b", { children: open[key] ? "\u2212" : "+" })
      ] }),
      open[key] && /* @__PURE__ */ u3("div", { class: "detail-content", children: content })
    ] });
    return /* @__PURE__ */ u3("div", { class: "details", children: [
      /* @__PURE__ */ u3("p", { class: "kicker", children: "Additional metadata" }),
      row("authorship", "Authorship", value("manufacturer") || "Not set", /* @__PURE__ */ u3("div", { class: "two-fields", children: [
        /* @__PURE__ */ u3(TextField, { label: "Author or foundry", value: value("manufacturer"), onInput: (event) => model.setFamily("manufacturer", event.currentTarget.value) }),
        /* @__PURE__ */ u3(TextField, { label: "Designer", value: value("designer"), onInput: (event) => model.setFamily("designer", event.currentTarget.value) }),
        /* @__PURE__ */ u3(TextField, { label: "Foundry website", value: value("vendor_url"), placeholder: "https://", onInput: (event) => model.setFamily("vendor_url", event.currentTarget.value) }),
        /* @__PURE__ */ u3(TextField, { label: "Designer website", value: value("designer_url"), placeholder: "https://", onInput: (event) => model.setFamily("designer_url", event.currentTarget.value) })
      ] })),
      row("license", "License", value("license") ? "Custom license" : "Not set", /* @__PURE__ */ u3("div", { class: "two-fields", children: [
        /* @__PURE__ */ u3(TextField, { label: "License text", area: true, value: value("license"), onInput: (event) => model.setFamily("license", event.currentTarget.value) }),
        /* @__PURE__ */ u3(TextField, { label: "License URL", value: value("license_url"), placeholder: "https://", onInput: (event) => model.setFamily("license_url", event.currentTarget.value) })
      ] })),
      row("release", "Version and description", value("version") || "Version 1.000", /* @__PURE__ */ u3("div", { class: "two-fields", children: [
        /* @__PURE__ */ u3(TextField, { label: "Version", value: value("version"), placeholder: "1.000", error: model.issues.find((item) => item.key === "version")?.message, onInput: (event) => model.setFamily("version", event.currentTarget.value) }),
        /* @__PURE__ */ u3(TextField, { label: "Description", area: true, value: value("description"), onInput: (event) => model.setFamily("description", event.currentTarget.value) })
      ] }))
    ] });
  }
  function Passport() {
    const model = useModel();
    const [active, setActive] = d2(model.familyFonts[0]?.id);
    return /* @__PURE__ */ u3(k, { children: [
      /* @__PURE__ */ u3(Title, { kicker: "Font passport", title: model.group, children: /* @__PURE__ */ u3("p", { class: "subline", children: [
        model.familyFonts.length,
        " faces \xB7 ",
        model.origin
      ] }) }),
      /* @__PURE__ */ u3("section", { class: "passport-intro", children: [
        /* @__PURE__ */ u3("div", { children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "01 / Name the family" }),
          /* @__PURE__ */ u3("h2", { children: "One name for the whole family." }),
          /* @__PURE__ */ u3("p", { children: "Every face follows this name. Adjust an individual face only when it needs a special install name." })
        ] }),
        /* @__PURE__ */ u3(FamilyField, {}),
        /* @__PURE__ */ u3("div", { class: "rename-preview", children: [
          /* @__PURE__ */ u3("span", { children: "Result" }),
          /* @__PURE__ */ u3("strong", { children: model.shared("family").value || "Family name" }),
          /* @__PURE__ */ u3("small", { children: [
            model.familyFonts.length,
            " faces use this name"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ u3("section", { class: "faces-block", children: [
        /* @__PURE__ */ u3("div", { class: "block-head", children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "02 / Check the faces" }),
          /* @__PURE__ */ u3("span", { children: [
            model.familyFonts.length,
            " faces \xB7 ",
            model.changed.length ? model.changed.length + " will change" : "No changes"
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { class: "face-list", children: model.familyFonts.map((font) => /* @__PURE__ */ u3(FaceLine, { font, active, setActive }, font.id)) }),
        /* @__PURE__ */ u3("label", { class: "sample-control", children: [
          /* @__PURE__ */ u3("span", { children: "Preview text" }),
          /* @__PURE__ */ u3("input", { value: model.sample, onInput: (event) => model.setSample(event.currentTarget.value) })
        ] }),
        /* @__PURE__ */ u3("p", { class: "face-help", children: "The other directions explore individual overrides and a guided review." })
      ] }),
      /* @__PURE__ */ u3(DetailRows, {})
    ] });
  }
  function Inspector() {
    const model = useModel();
    const [active, setActive] = d2(model.familyFonts[0]?.id);
    const font = model.fonts.find((item) => item.id === active) || model.familyFonts[0];
    const value = model.effective(font);
    const manual = Boolean(model.draft.faces[font.id]);
    return /* @__PURE__ */ u3(k, { children: [
      /* @__PURE__ */ u3(Title, { kicker: "Font passport / Inspector", title: "Shape the family.", children: /* @__PURE__ */ u3("p", { class: "subline", children: "Choose a face, then control its exact install names." }) }),
      /* @__PURE__ */ u3("div", { class: "inspector-layout", children: [
        /* @__PURE__ */ u3("section", { class: "face-rail", children: [
          /* @__PURE__ */ u3("div", { class: "block-head", children: [
            /* @__PURE__ */ u3("p", { class: "kicker", children: "Faces" }),
            /* @__PURE__ */ u3("span", { children: [
              model.familyFonts.length,
              " total"
            ] })
          ] }),
          model.familyFonts.map((item) => /* @__PURE__ */ u3(FaceLine, { font: item, active, setActive, compact: true }, item.id))
        ] }),
        /* @__PURE__ */ u3("section", { class: "inspector-main", children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "01 / Family" }),
          /* @__PURE__ */ u3(FamilyField, {}),
          /* @__PURE__ */ u3("p", { class: "hint", children: "Changing this updates all automatic faces." }),
          /* @__PURE__ */ u3("div", { class: "selected-face-head", children: [
            /* @__PURE__ */ u3("div", { children: [
              /* @__PURE__ */ u3("p", { class: "kicker", children: "02 / Selected face" }),
              /* @__PURE__ */ u3("h2", { children: value.subfamily })
            ] }),
            /* @__PURE__ */ u3("label", { class: "switch", children: [
              /* @__PURE__ */ u3("input", { type: "checkbox", checked: manual, onChange: (event) => model.manual(font, event.currentTarget.checked) }),
              /* @__PURE__ */ u3("span", { children: "Custom names" })
            ] })
          ] }),
          manual ? /* @__PURE__ */ u3("div", { class: "override-fields", children: [
            /* @__PURE__ */ u3(TextField, { label: "Style name", value: value.subfamily, onInput: (event) => model.setFace(font.id, "subfamily", event.currentTarget.value) }),
            /* @__PURE__ */ u3(TextField, { label: "Full name", value: value.full_name, onInput: (event) => model.setFace(font.id, "full_name", event.currentTarget.value) }),
            /* @__PURE__ */ u3(TextField, { label: "PostScript name", value: value.postscript, error: model.issues.find((item) => item.id === font.id && item.key === "postscript")?.message, onInput: (event) => model.setFace(font.id, "postscript", event.currentTarget.value) }),
            /* @__PURE__ */ u3(TextField, { label: "File name", value: value.filename, error: model.issues.find((item) => item.id === font.id && item.key === "filename")?.message, onInput: (event) => model.setFace(font.id, "filename", event.currentTarget.value) })
          ] }) : /* @__PURE__ */ u3("div", { class: "derived", children: [
            /* @__PURE__ */ u3("div", { children: [
              /* @__PURE__ */ u3("span", { children: "Full name" }),
              /* @__PURE__ */ u3("strong", { children: value.full_name })
            ] }),
            /* @__PURE__ */ u3("div", { children: [
              /* @__PURE__ */ u3("span", { children: "PostScript" }),
              /* @__PURE__ */ u3("strong", { children: value.postscript })
            ] }),
            /* @__PURE__ */ u3("div", { children: [
              /* @__PURE__ */ u3("span", { children: "File name" }),
              /* @__PURE__ */ u3("strong", { children: [
                value.filename,
                ".",
                font.format === "woff2" ? "otf" : font.format
              ] })
            ] }),
            /* @__PURE__ */ u3("small", { children: "Automatic names follow the family. Turn on Custom names to edit them." })
          ] }),
          /* @__PURE__ */ u3("div", { class: "before-after", children: [
            /* @__PURE__ */ u3("span", { children: "Before" }),
            /* @__PURE__ */ u3("b", { children: font.names.full_name || font.file }),
            /* @__PURE__ */ u3("span", { children: "After" }),
            /* @__PURE__ */ u3("b", { children: value.full_name })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ u3(DetailRows, {})
    ] });
  }
  function Steps() {
    const model = useModel();
    const [step, setStep] = d2(1);
    const [active, setActive] = d2(model.familyFonts[0]?.id);
    return /* @__PURE__ */ u3(k, { children: [
      /* @__PURE__ */ u3(Title, { kicker: "Step " + step + " of 3", title: step === 1 ? "Name it once." : step === 2 ? "Check every face." : "Ready to download.", children: /* @__PURE__ */ u3("p", { class: "subline", children: "A short review before Fount writes new copies." }) }),
      /* @__PURE__ */ u3("nav", { class: "steps", children: [
        /* @__PURE__ */ u3("button", { class: step === 1 ? "active" : "", onClick: () => setStep(1), children: [
          /* @__PURE__ */ u3("b", { children: "01" }),
          "Name"
        ] }),
        /* @__PURE__ */ u3("button", { class: step === 2 ? "active" : "", onClick: () => setStep(2), children: [
          /* @__PURE__ */ u3("b", { children: "02" }),
          "Faces"
        ] }),
        /* @__PURE__ */ u3("button", { class: step === 3 ? "active" : "", onClick: () => setStep(3), children: [
          /* @__PURE__ */ u3("b", { children: "03" }),
          "Finish"
        ] })
      ] }),
      step === 1 && /* @__PURE__ */ u3("section", { class: "step-panel", children: [
        /* @__PURE__ */ u3("p", { class: "kicker", children: "Family name" }),
        /* @__PURE__ */ u3(FamilyField, {}),
        /* @__PURE__ */ u3("div", { class: "big-result", children: model.shared("family").value }),
        /* @__PURE__ */ u3("button", { class: "next", onClick: () => setStep(2), children: "Review faces \u2192" })
      ] }),
      step === 2 && /* @__PURE__ */ u3("section", { class: "step-panel", children: [
        /* @__PURE__ */ u3("div", { class: "block-head", children: [
          /* @__PURE__ */ u3("p", { class: "kicker", children: "Resulting files" }),
          /* @__PURE__ */ u3("span", { children: [
            model.familyFonts.length,
            " faces"
          ] })
        ] }),
        /* @__PURE__ */ u3("div", { class: "review-list", children: model.familyFonts.map((font) => /* @__PURE__ */ u3(FaceLine, { font, active, setActive }, font.id)) }),
        /* @__PURE__ */ u3("p", { class: "review-note", children: "All names are generated automatically from the family name." }),
        /* @__PURE__ */ u3("button", { class: "next", onClick: () => setStep(3), children: "Continue to details \u2192" })
      ] }),
      step === 3 && /* @__PURE__ */ u3("section", { class: "step-panel ready-panel", children: [
        /* @__PURE__ */ u3("p", { class: "kicker", children: "Ready" }),
        /* @__PURE__ */ u3("h2", { children: [
          model.familyFonts.length,
          " files will be prepared."
        ] }),
        /* @__PURE__ */ u3("div", { class: "ready-list", children: model.familyFonts.map((font) => /* @__PURE__ */ u3("span", { children: [
          model.effective(font).filename,
          ".",
          font.format === "woff2" ? "otf" : font.format,
          " ",
          /* @__PURE__ */ u3("b", { children: "\u2713" })
        ] })) }),
        /* @__PURE__ */ u3("p", { children: "Fount creates copies with the new metadata. Source files stay untouched." }),
        /* @__PURE__ */ u3("button", { class: "next", onClick: () => model.download(), children: [
          "Download ",
          model.familyFonts.length,
          " files \u2193"
        ] })
      ] }),
      /* @__PURE__ */ u3(DetailRows, {})
    ] });
  }
  function ActionBar() {
    const model = useModel();
    return /* @__PURE__ */ u3("div", { class: "action-bar", children: [
      /* @__PURE__ */ u3("span", { children: [
        /* @__PURE__ */ u3("b", { children: model.notice || model.error || (model.changed.length ? model.changed.length + " faces will change" : "No changes yet") }),
        /* @__PURE__ */ u3("small", { children: "Copies are created; originals stay untouched." })
      ] }),
      /* @__PURE__ */ u3("button", { disabled: Boolean(model.busy || model.issues.length), onClick: () => model.download(), children: model.notice ? "Download again" : "Download " + model.familyFonts.length + " files \u2193" })
    ] });
  }
  function Picker({ variant, setVariant }) {
    const names = ["Passport", "Inspector", "Steps"];
    const picker = A2(null);
    const highlight = A2(null);
    const items = A2([]);
    const move = () => {
      const item = items.current[variant - 1];
      if (!item || !highlight.current) return;
      highlight.current.style.width = item.offsetWidth + "px";
      highlight.current.style.transform = "translateX(" + item.offsetLeft + "px)";
    };
    y2(() => {
      move();
      requestAnimationFrame(() => picker.current?.setAttribute("data-ready", ""));
    }, [variant]);
    y2(() => {
      addEventListener("resize", move);
      return () => removeEventListener("resize", move);
    }, []);
    y2(() => {
      const onKey = (event) => {
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName) || event.target.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
        const number = Number(event.key);
        if (number >= 1 && number <= names.length) setVariant(number);
        else if (event.key === "ArrowRight") setVariant(variant === names.length ? 1 : variant + 1);
        else if (event.key === "ArrowLeft") setVariant(variant === 1 ? names.length : variant - 1);
      };
      addEventListener("keydown", onKey);
      return () => removeEventListener("keydown", onKey);
    }, [variant]);
    return /* @__PURE__ */ u3("nav", { ref: picker, class: "proto-picker", "aria-label": "Prototype variants", children: [
      /* @__PURE__ */ u3("span", { ref: highlight, class: "proto-picker-highlight", "aria-hidden": "true" }),
      names.map((name, i3) => /* @__PURE__ */ u3("button", { ref: (element) => {
        items.current[i3] = element;
      }, class: "proto-picker-item", "data-active": variant === i3 + 1 ? "" : void 0, "aria-current": variant === i3 + 1 ? "true" : void 0, onClick: () => setVariant(i3 + 1), children: name })),
      /* @__PURE__ */ u3("span", { class: "proto-picker-divider", "aria-hidden": "true" }),
      /* @__PURE__ */ u3("button", { class: "proto-picker-item proto-picker-replay", "aria-label": "Replay animation (R)", children: "\u21BB" })
    ] });
  }
  G(/* @__PURE__ */ u3(App, {}), document.getElementById("app"));
})();
