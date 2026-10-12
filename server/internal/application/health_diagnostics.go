package application

import "jpano.dev/portfolio/internal/diagnostics"

func databaseFailureCode(err error) string     { return diagnostics.FailureCode(err) }
func databaseFailureAdvice(code string) string { return diagnostics.FailureAdvice(code) }
