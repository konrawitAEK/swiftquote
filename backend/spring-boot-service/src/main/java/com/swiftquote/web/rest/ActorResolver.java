package com.swiftquote.web.rest;

import org.springframework.core.MethodParameter;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;

import com.swiftquote.domain.Actor;
import com.swiftquote.domain.ApiException;
import com.swiftquote.service.AuthService;

/**
 * Resolves an {@link Actor} handler parameter from the bearer token, reloading the caller from the database on every
 * request (Go's requireAuth). Only routes that declare an Actor need a token, so unknown routes stay 404.
 */
@Component
class ActorResolver implements HandlerMethodArgumentResolver {

	private static final String PREFIX = "Bearer ";

	private final AuthService auth;

	ActorResolver(AuthService auth) {
		this.auth = auth;
	}

	@Override
	public boolean supportsParameter(MethodParameter parameter) {
		return parameter.getParameterType() == Actor.class;
	}

	@Override
	public Actor resolveArgument(MethodParameter parameter, ModelAndViewContainer mavContainer,
			NativeWebRequest webRequest, WebDataBinderFactory binderFactory) {
		String header = webRequest.getHeader(HttpHeaders.AUTHORIZATION);
		if (header == null || !header.startsWith(PREFIX) || header.length() == PREFIX.length()) {
			throw ApiException.unauthorized("missing bearer token");
		}
		return this.auth.authenticate(header.substring(PREFIX.length()));
	}

}
