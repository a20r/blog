---
topics: [go, errors, programming, open-source]
date: 2026-07-30
summary: "Go makes you choose between errors you can match and errors that say anything useful. Falta is my ~200-line answer: define an error factory once, stamp out instances with context, and errors.Is still works. Templates, generics, and a defer trick included."
---

# Falta: Error Factories for Go

Go's error handling forces an annoying choice on you the moment an error needs to carry information. You can have an error with an *identity*:

```go
var ErrNotFound = errors.New("user not found")
```

which callers can match with `errors.Is(err, ErrNotFound)` but which will never tell you *which* user wasn't found. Or you can have an error with *context*:

```go
return fmt.Errorf("user %s not found", id)
```

which tells you everything and matches nothing — every call site mints a brand-new error value that no `errors.Is` check will ever recognize. The blessed way to get both is to wrap the sentinel:

```go
return fmt.Errorf("%w: %s", ErrNotFound, id)
```

and this works, but I've never liked it. The sentinel and its formatting are now two separate things you have to keep next to each other by discipline. Every call site re-decides how the context gets glued on. And the sentinel's message ("user not found") and the actual rendered message ("user not found: alice") are related only by convention.

What I actually want is to define the *shape* of an error once — message, placeholders, identity — and then stamp out instances of it with the details filled in. A factory. So I wrote one: [falta](https://github.com/a20r/falta), a small Go package (the whole thing is one ~200-line file) built around exactly that idea. *Falta* is Spanish for a lack, a shortcoming — and also a foul in soccer, which given [what](/posts/capitulation-basket/) [else](/posts/a-momentum-field-for-soccer/) I write about here felt like destiny.

## Factories

The core type is a `Factory`: something that is itself an `error` and can produce errors.

```go
type Factory[T any] interface {
    error
    New(vs ...T) Falta
}
```

You define factories as package-level vars, the same place you'd put sentinels. The flavor I use most takes a type parameter and a `text/template` string over it:

```go
type Circle struct {
    Radius float64
}

var ErrInvalidCircle = falta.New[Circle]("invalid circle: radius ({{.Radius}}) <= 0")

func IsCircleValid(circle Circle) error {
    if circle.Radius <= 0 {
        return ErrInvalidCircle.New(circle)
    }
    return nil
}
```

Calling `IsCircleValid(Circle{Radius: -1})` gets you an error that prints as `invalid circle: radius (-1) <= 0`. The generics matter here: `ErrInvalidCircle.New` takes a `Circle`, not an `any`, so you can't hand the wrong data to the wrong error. The template *is* the error definition — the message and its parameters live in one string, in one place.

If generics feel like too much ceremony for a quick error, there's a printf flavor:

```go
var ErrCannotOpenFile = falta.Newf("open: cannot open file %s")

return ErrCannotOpenFile.New(name)
```

and a map flavor for when the fields are ad hoc:

```go
var ErrCallFailed = falta.NewM("api: [code={{.code}}] call failed: '{{.message}}'")

return ErrCallFailed.New(falta.M{
    "code":    503,
    "message": "Bad Gateway",
})
```

## Identity without sentinels

Here's the part that makes it a real replacement for sentinels rather than a formatting toy: the factory itself satisfies `error`, and errors it produces match it.

```go
err := IsCircleValid(circle)

if errors.Is(err, ErrInvalidCircle) {
    // yes — even though err says "radius (-1)" and the
    // factory has never seen your circle
}
```

Two different instances from the same factory also `errors.Is` each other, regardless of what values they were built with. The identity of a falta error is its *format string* — the template, not the rendered output and not a pointer. `New` records the format alongside the rendered message, and `Is` compares formats. Every error stamped from the same mold matches the mold and its siblings.

That's a design choice with a sharp edge worth naming: if two factories in your program happen to use the exact same format string, their errors are indistinguishable to `errors.Is`. I consider this fine — if two errors render identically in your logs, no human could tell them apart either, so the machine agreeing feels honest — but it is a thing to know.

## Wrap, Annotate, and the usual chain

Falta errors participate in the standard wrapping machinery. `Wrap` chains an underlying cause and `Unwrap` exposes it, so `errors.Is` walks through as you'd expect:

```go
f, err := os.Open(name)
if err != nil {
    return ErrCannotOpenFile.New(name).Wrap(err)
}
```

The result matches both `ErrCannotOpenFile` *and* whatever `os.Open` returned (say, `fs.ErrNotExist`). `Annotate` tacks on plain-text context when something surprising is happening:

```go
return ErrCallFailed.New(vals).Annotate("this API was deprecated last spring").Wrap(err)
```

which renders as the pieces joined with `: `, oldest first — the same shape hand-wrapped Go errors already have, so falta errors don't look alien in a log line next to ordinary ones.

## Capture: wrap everything on the way out

My favorite piece of the package is `Capture`. A pattern I kept writing by hand: a function has five return points, and I want *every* error leaving it to be wrapped in the same way, without repeating the wrap five times. With a named return value and a `defer`, falta does it once at the top:

```go
var ErrCannotProcess = falta.Newf("process: cannot process job %s")

func process(job string) (err error) {
    defer ErrCannotProcess.New(job).Capture(&err)

    // ... every `return err` below comes out wrapped as
    // "process: cannot process job <job>: <original error>"
}
```

`Capture` checks the pointed-to error on the way out and wraps it if it's non-nil. The named return is load-bearing — `defer` runs after the return value is set, so the pointer has to refer to the actual result variable. It's a small thing, but it changed how the packages I use falta in read: the error policy of a function is declared in its first line instead of smeared across its exits.

## Composing factories

Factories can also be extended — append another factory's template to get a more specific error that still renders as one message:

```go
var ErrCallFailed = falta.NewM("api: [code={{.code}}] call failed")
var ErrCallFailedWithReason = ErrCallFailed.Extend(falta.NewM("because {{.reason}}"))
```

I'll be honest: I use this the least. But it falls out of the factory model almost for free, and when you have a family of errors that share a prefix, defining the prefix once is the same instinct as defining the format once.

## Deliberately loud

A few things in falta panic, and all of them are on purpose. `NewError` and `Annotate` panic if you hand them a string containing fmt verbs — those functions take finished text, and a stray `%s` in them is a bug at the definition site, not a runtime condition to limp past. Template execution failures panic too. The philosophy: error *definitions* are code, and broken code should fail the way broken code fails — immediately, during development, in your face — not by quietly emitting a mangled message from some production log at 3am.

That's the whole package, honestly. No error codes, no stack traces, no severity levels, no registry. Go's error model — values, wrapping, `errors.Is` — is genuinely good; it just makes you choose between identity and context at every call site. Falta's one idea is that you shouldn't have to: define the mold once, stamp out errors with the details filled in, and let the mold be the thing you match against. It's on [GitHub](https://github.com/a20r/falta) if you want to kick the tires.
