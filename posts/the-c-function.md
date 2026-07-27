---
topics: [go, programming, experiments]
date: 2022-02-11
summary: "Can a Go function count how many times you chain-call it? Recursive function types, a pointer smuggled through a closure, and C(c()()()()) == 4. Not useful!"
---
# The C Function

> **Warning:** What follows is not useful!

While lying in bed one night many moons ago, I thought to myself: can you write a function in Go that counts how many parenthesis it was called with?

In particular, I was interested in seeing if I could count the number of parenthesis pairs in a Go function call. For instance, imagine a function in Go named `c`, I wanted to know if you could get `c()` to return 1, `c()()` to return 2, and so on.

We immediately face an obstacle: how do I write a signature for a function that can be chain called indefinitely? `c()` must return a function that returns a function that returns a function that returns a function and so on. Sounds like recursion.

After some tinkering, I found that Go supports recursive function type definitions. You can define a function type that returns itself! I can create a type called `self` defined as a function that returns `self`.

```go
type self func() self
```

Now I can take a stab at implementing `c` like:

```go
func c() self {
    return c
}
```

This will let chain calls to `c` indefinitely like `c()()()()...()` but doesn't actually count the number of calls and even if it was counting the number of calls, how would I even retrieve that value? For us to be able to call `c()()`, `c()` must return a function, but if `c()` returns a function, it cannot return a number. This makes it impossible to write a function signature for `c` such that `c()()()()...()` returns an integer.

Okay, well that sucks but this wasn't supposed to be practical, this was supposed to be fun and confusing. I will allow myself to do something a little different on the final call to `c` that still makes it look like a bunch of parantheses but is not necessarily another chained call.

For now, let's use a global variable to track the number of calls to `c`.

```go
type self func() self

var count = 0

func inc() self {
    count++
    return inc
}

func c() self {
    count = 1
    return inc
}
```

Now I can count the number of chained calls, but I still cannot retrieve it from the result of the chain.

One interesting way to retrieve the count as a result of the chain is to attach a function to the `self` type that returns `count`. Yes, that is right, you can attach a function to a function type.

```go
type self func() self

var count = 0

func (self) c() int {
    return count
}

func inc() self {
    count++
    return inc
}

func c() self {
    count = 1
    return inc
}
```

This will now let us chain calls to `c` indefinitely and retrieve the count as a result of the function chain like:

```go
c()()().c() == 4
```

This method for a function thing is interesting… but this ruins the aesthetic! Can we do something prettier?

We could implement another function that takes the function chain then simply returns `count`. Let's call it `C` to keep things confusing.

```go
type self func() self

var count int

func c() self {
    count++
    return c
}

func C(self) int {
    defer func() {
        count = 0
    }()

    return count
}
```

So now we are able to wrap the chained calls to `c` with a call to `C` to retrieve the number of times `c` was called.

```go
C(c()()()()) == 4
```

I find this format more inline with the original goal. This approach also removes the need for the intermediate `inc` function because the outer `C` function is reseting the counter.

But what if we are using this in an extremely concurrent system? Using a global variable is a recipe for disaster. There would be so much lock contention. There has to be a way to achieve the same dumb result without using a global variable.

We could change the definition of `self` such that we can pass the current count as a parameter to future calls of `c`.

```go
type self func(i ...int) self

func c(i ...int) self {
	count := 1

	if len(i) > 0 {
		count = i[0]
	}

	return func(i ...int) self {
		return c(count+1)
	}
}
```

But now we are stuck again not being able to retrieve the value of `count` because it is part of the local function scope.

We can use a pointer instead of a value for `count` when passing it to `c`. This way we can capture the value in the outer `C` function.

```go
type self func(i ...*int) self

func c(i ...*int) self {
	count := new(int)
	*count = 0

	if len(i) > 0 {
		count = i[0]
	}

	return func(i ...*int) self {
		*count++

		if len(i) > 0 {
			*i[0] = *count
		}

		return c(count)
	}
}

func C(fn self) int {
	var count int
	fn(&count)
	return count
}
```

See how the function inside of `c` sets the value of the pointer if one is provided. This let's us make another call to the `self` chain from `C` to capture the value of `count`.

Now `C(c()()()()) == 4` without using global variables.

I think I learned from this but I am not sure what it is going to be useful for besides making this blog
